import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { KnowledgeError, runFileSystemIo } from "./errors.js";
import { relationsFor, type KnowledgeModel } from "./knowledge-model.js";
import { isInboxCandidateId, listWorktreeInboxIds } from "./inbox.js";
import { navigationChanged } from "./navigation.js";
import type { KnowledgeSnapshot } from "./read.js";
import type { KnowledgeMeta, ValidatedEvidence } from "./meta.js";
import { canonicalizeSourcePath, type KnowledgeDocument } from "./document.js";
import { REPOSITORY_ID_PATTERN } from "./identity.js";
import { sameRealPath } from "./paths.js";
import type { KnowledgeWriteContext } from "./write-context.js";

export function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export const REVIEW_SCHEMA = "llmdoc.review/v1";
export const REVIEWS_DIRNAME = "reviews";
export const REVIEW_ID_PATTERN = /^[0-9a-f]{32}$/;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ACTIONS: readonly ReviewAction[] = ["add", "update", "refresh", "delete"];
const CONCLUSIONS: readonly ReviewConclusion[] = ["changed", "unchanged", "insufficient"];

export function isValidReviewId(value: unknown): value is string {
  return typeof value === "string" && REVIEW_ID_PATTERN.test(value);
}

export type ReviewConclusion = "changed" | "unchanged" | "insufficient";
export type ReviewAction = "add" | "update" | "refresh" | "delete";

export interface ReviewRequireBinding {
  id: string;
  digest: string;
}

export interface ReviewDocumentItem {
  id: string;
  action: ReviewAction;
  oldDigest: string | null;
  candidateDigest: string | null;
  oldSourceRevision: string | null;
  oldScope: string[];
  newScope: string[];
  removedScope: string[];
  oldValidatedRequires: Record<string, string>;
  candidateRequires: ReviewRequireBinding[];
  reasons: string[];
  proposedConclusion: ReviewConclusion;
  conclusion: ReviewConclusion | null;
}

export interface ReviewWriteSet {
  documents: string[];
  refresh: string[];
  deletions: string[];
  /** inbox candidate ids removed by this seal (promotion or rejection). */
  candidates: string[];
  meta: boolean;
  generated: string[];
}

export interface ReviewManifest {
  schema: typeof REVIEW_SCHEMA;
  reviewId: string;
  repositoryId: string;
  sourceRevision: string;
  knowledgeBaseRevision: string;
  sourceRoot: string;
  knowledgeRoot: string;
  createdAt: string;
  global: boolean;
  advanceGlobalReview: boolean;
  notes: string[];
  documents: ReviewDocumentItem[];
  writeSet: ReviewWriteSet;
  confirmed: boolean;
  confirmedAt: string | null;
  consumed: boolean;
  consumedAt: string | null;
  knowledgeRevision: string | null;
}

export function reviewsDirectory(knowledgeRoot: string): string {
  return path.join(knowledgeRoot, ".llmdoc-cache", REVIEWS_DIRNAME);
}

export function reviewFilePath(knowledgeRoot: string, reviewId: string): string {
  if (!isValidReviewId(reviewId)) {
    throw invalidManifest(`Invalid reviewId: ${String(reviewId)}`, reviewId);
  }
  return path.join(reviewsDirectory(knowledgeRoot), `${reviewId}.json`);
}

export function generateReviewId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export interface BuildReviewOptions {
  global?: boolean;
  now?: Date;
}

/**
 * Computes the deterministic review candidates for the fixed S/K0 pair. Body content,
 * scope, requires and the resulting write set are recorded so any later drift is
 * detectable, but the semantic conclusion is only a proposal until explicitly confirmed.
 */
export function buildReviewManifest(context: KnowledgeWriteContext, options: BuildReviewOptions = {}): ReviewManifest {
  const sourceRevision = context.source.headRevision;
  if (sourceRevision === null || context.knowledgeHead === null) {
    throw new KnowledgeError("E_SOURCE_INVALID_HEAD", "Review requires fixed source and knowledge revisions", {
      exitCode: 3,
      paths: [context.source.worktreeRoot, context.knowledge.worktreeRoot]
    });
  }
  const items = buildReviewItems(context, {});
  const conclusions = new Map(items.map((item) => [item.id, item.proposedConclusion]));
  const withRequires = attachCandidateRequires(context, items, conclusions);
  const writeSet = deriveWriteSet(withRequires, conclusions, options.global === true, context);
  return {
    schema: REVIEW_SCHEMA,
    reviewId: generateReviewId(),
    repositoryId: context.entry.repositoryId,
    sourceRevision,
    knowledgeBaseRevision: context.knowledgeHead,
    sourceRoot: context.source.worktreeRoot,
    knowledgeRoot: context.knowledge.worktreeRoot,
    createdAt: (options.now ?? new Date()).toISOString(),
    global: options.global === true,
    advanceGlobalReview: options.global === true,
    notes: [],
    documents: withRequires,
    writeSet,
    confirmed: false,
    confirmedAt: null,
    consumed: false,
    consumedAt: null,
    knowledgeRevision: null
  };
}

export function buildReviewItems(
  context: KnowledgeWriteContext,
  overrides: Record<string, ReviewConclusion>
): ReviewDocumentItem[] {
  const k0Meta = context.k0.meta;
  const ids = new Set<string>([...context.k0Model.byId.keys(), ...context.worktreeModel.byId.keys()]);
  const all = new Map<string, ReviewDocumentItem>();
  for (const id of [...ids].sort()) {
    all.set(id, computeItem(context, id, k0Meta));
  }
  const selected = new Map<string, ReviewDocumentItem>();
  for (const [id, item] of all) {
    if (isCandidate(item.action, item.oldDigest, item.candidateDigest, item.reasons)) {
      selected.set(id, item);
    }
  }
  // A document whose requires target will change in this batch has its own evidence
  // invalidated by that seal, so it must appear as a candidate too (architecture §4/§6).
  const reverse = buildReverseRequires(context.worktreeModel);
  const queue = [...selected.values()].filter((item) => item.action !== "refresh").map((item) => item.id);
  const visited = new Set(queue);
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const dependent of reverse.get(source) ?? []) {
      const base = all.get(dependent);
      if (base === undefined) {
        continue;
      }
      const batchReason = `requires target changes in this review batch: ${source}`;
      let item = selected.get(dependent);
      if (item === undefined) {
        item = { ...base, reasons: [...base.reasons, batchReason] };
        selected.set(dependent, item);
      } else if (!item.reasons.includes(batchReason)) {
        item = { ...item, reasons: [...item.reasons, batchReason] };
        selected.set(dependent, item);
      }
      if (item.action !== "refresh" && !visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...selected.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => ({ ...item, conclusion: overrides[item.id] ?? null }));
}

function computeItem(
  context: KnowledgeWriteContext,
  id: string,
  k0Meta: KnowledgeMeta | null
): ReviewDocumentItem {
  const oldDoc = context.k0Model.byId.get(id);
  const newDoc = context.worktreeModel.byId.get(id);
  const evidence: ValidatedEvidence | undefined = k0Meta?.documents[id];
  const action = actionFor(oldDoc, newDoc);
  const oldDigest = oldDoc?.contentDigest ?? null;
  const candidateDigest = newDoc?.contentDigest ?? null;
  const oldScope = [...(evidence?.validatedSourcePaths ?? [])];
  const newScope = [...(newDoc?.frontmatter.source.paths ?? [])];
  const oldValidatedRequires = { ...(evidence?.validatedRequires ?? {}) };
  const validityReasons = context.validity.byId.get(id)?.reasons ?? [];
  const reasons = collectReasons(action, oldDoc, newDoc, validityReasons);
  const removedScope = oldScope.filter((entry) => !newScope.includes(entry));
  const proposed: ReviewConclusion = action === "refresh" && oldDigest === candidateDigest ? "unchanged" : "changed";
  return {
    id,
    action,
    oldDigest,
    candidateDigest,
    oldSourceRevision: evidence?.validatedSourceRevision ?? null,
    oldScope,
    newScope,
    removedScope,
    oldValidatedRequires,
    candidateRequires: [],
    reasons,
    proposedConclusion: proposed,
    conclusion: null
  };
}

function buildReverseRequires(model: KnowledgeModel): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const document of model.documents) {
    for (const target of relationsFor(model, document.id).requires) {
      const bucket = reverse.get(target) ?? [];
      bucket.push(document.id);
      reverse.set(target, bucket);
    }
  }
  for (const bucket of reverse.values()) {
    bucket.sort();
  }
  return reverse;
}

function actionFor(oldDoc: KnowledgeDocument | undefined, newDoc: KnowledgeDocument | undefined): ReviewAction {
  if (oldDoc === undefined) {
    return "add";
  }
  if (newDoc === undefined) {
    return "delete";
  }
  if (oldDoc.contentDigest !== newDoc.contentDigest) {
    return "update";
  }
  return "refresh";
}

function collectReasons(
  action: ReviewAction,
  oldDoc: KnowledgeDocument | undefined,
  newDoc: KnowledgeDocument | undefined,
  validityReasons: string[]
): string[] {
  const reasons: string[] = [];
  if (action === "add") {
    reasons.push("New document has no validation evidence");
  }
  if (action === "delete") {
    reasons.push("Document is deleted from the knowledge worktree");
  }
  if (action === "update") {
    reasons.push("Document content changed since K0");
  }
  if (newDoc !== undefined && oldDoc !== undefined) {
    const before = [...(oldDoc.frontmatter.source.paths ?? [])].sort();
    const after = [...(newDoc.frontmatter.source.paths ?? [])].sort();
    if (!sameList(before, after)) {
      reasons.push("Source scope changed");
    }
  }
  for (const reason of validityReasons) {
    if (!reasons.includes(reason)) {
      reasons.push(reason);
    }
  }
  return reasons;
}

function isCandidate(action: ReviewAction, oldDigest: string | null, candidateDigest: string | null, reasons: string[]): boolean {
  const contentChanged = action !== "refresh" || oldDigest !== candidateDigest;
  return contentChanged || reasons.length > 0;
}

/**
 * Fills each item's `candidateRequires` with the final digest of every direct requires
 * target under the given conclusions. A target sealed as `changed` binds its candidate
 * digest; every other target binds its K0 (committed) digest.
 */
export function attachCandidateRequires(
  context: KnowledgeWriteContext,
  items: ReviewDocumentItem[],
  conclusions: Map<string, ReviewConclusion>
): ReviewDocumentItem[] {
  const finalDigest = computeFinalDigests(context, items, conclusions);
  return items.map((item) => {
    const document = context.worktreeModel.byId.get(item.id);
    if (document === undefined) {
      return { ...item, candidateRequires: [] };
    }
    const requires = relationsFor(context.worktreeModel, item.id).requires;
    const candidateRequires: ReviewRequireBinding[] = [];
    for (const target of requires) {
      const digest = finalDigest.get(target);
      if (digest !== undefined && digest !== null) {
        candidateRequires.push({ id: target, digest });
      }
    }
    return { ...item, candidateRequires };
  });
}

export function computeFinalDigests(
  context: KnowledgeWriteContext,
  items: ReviewDocumentItem[],
  conclusions: Map<string, ReviewConclusion>
): Map<string, string | null> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const finalDigest = new Map<string, string | null>();
  for (const document of context.worktreeModel.documents) {
    finalDigest.set(document.id, document.contentDigest);
  }
  for (const item of items) {
    const conclusion = conclusions.get(item.id) ?? item.proposedConclusion;
    if (conclusion === "insufficient" || item.action === "refresh") {
      // Not advanced, or the body is byte-identical to K0: the committed digest stays K0's.
      finalDigest.set(item.id, item.oldDigest);
    } else if (item.action === "delete") {
      finalDigest.set(item.id, null);
    } else {
      // add/update: the candidate bytes are physically written to K1.
      finalDigest.set(item.id, item.candidateDigest);
    }
  }
  // Documents present only in K0 and deleted are no longer addressable as targets.
  for (const id of context.k0Model.byId.keys()) {
    if (!byId.has(id) && !context.worktreeModel.byId.has(id)) {
      finalDigest.set(id, null);
    }
  }
  return finalDigest;
}

export function deriveWriteSet(
  items: ReviewDocumentItem[],
  conclusions: Map<string, ReviewConclusion>,
  advanceGlobalReview: boolean,
  context?: KnowledgeWriteContext
): ReviewWriteSet {
  const documents: string[] = [];
  const refresh: string[] = [];
  const deletions: string[] = [];
  for (const item of items) {
    const conclusion = conclusions.get(item.id) ?? item.proposedConclusion;
    if (conclusion === "insufficient") {
      continue;
    }
    // The physical write set is determined by the candidate's byte/path action relative
    // to K0, never by the semantic conclusion label: add/update must be written, delete
    // must be removed, refresh is a physical no-op. `insufficient` is the only no-advance.
    if (item.action === "delete") {
      deletions.push(item.id);
    } else if (item.action === "add" || item.action === "update") {
      documents.push(item.id);
    } else {
      refresh.push(item.id);
    }
  }
  const candidates = context ? computeRemovedCandidates(context) : [];
  // Navigation is only regenerated when the document set or bytes actually change; a
  // pure meta-only refresh or a global-review advance must not fabricate a README commit.
  const contentChange = documents.length + deletions.length + candidates.length > 0;
  const navigation = contentChange && context ? navigationChanged(context) : false;
  const meta = documents.length + refresh.length + deletions.length + candidates.length > 0 || advanceGlobalReview;
  const generated: string[] = [];
  if (meta) {
    generated.push(".llmdoc/meta.json");
  }
  if (navigation) {
    generated.push("README.md");
  }
  return {
    documents: documents.sort(),
    refresh: refresh.sort(),
    deletions: deletions.sort(),
    candidates: candidates.sort(),
    meta,
    generated
  };
}

function computeRemovedCandidates(context: KnowledgeWriteContext): string[] {
  const committed = new Set<string>();
  const worktree = new Set(listWorktreeInboxIds(context.knowledge.worktreeRoot));
  for (const id of context.k0InboxIds ?? []) {
    if (!worktree.has(id)) {
      committed.add(id);
    }
  }
  return [...committed].sort();
}

/**
 * Writes a manifest under the caller's trusted knowledge root. The manifest's own
 * `knowledgeRoot` is never used to choose a path: it is overwritten with the trusted
 * root so tampered cache content cannot redirect the write outside the knowledge repo.
 */
export function writeReviewManifest(knowledgeRoot: string, manifest: ReviewManifest): void {
  const trusted: ReviewManifest = { ...manifest, knowledgeRoot };
  const directory = reviewsDirectory(knowledgeRoot);
  runFileSystemIo(() => fs.mkdirSync(directory, { recursive: true }), "Failed to create the review cache directory", [directory]);
  const filePath = reviewFilePath(knowledgeRoot, trusted.reviewId);
  validateReviewManifest(trusted, filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  runFileSystemIo(
    () => fs.writeFileSync(tempPath, `${JSON.stringify(trusted, null, 2)}\n`, "utf8"),
    "Failed to write the review manifest",
    [filePath]
  );
  runFileSystemIo(() => fs.renameSync(tempPath, filePath), "Failed to publish the review manifest", [filePath]);
}

export function loadReviewManifest(knowledgeRoot: string, reviewId: string): ReviewManifest {
  if (!isValidReviewId(reviewId)) {
    throw invalidManifest(`Invalid reviewId: ${String(reviewId)}`, reviewId);
  }
  const filePath = reviewFilePath(knowledgeRoot, reviewId);
  if (!fs.existsSync(filePath)) {
    throw new KnowledgeError("E_REVIEW_NOT_FOUND", `No review manifest exists for reviewId ${reviewId}`, {
      paths: [filePath],
      remediation: "Run `llmdoc review` to generate a manifest before committing."
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw invalidManifest(`The review manifest is not valid JSON: ${(error as Error).message}`, filePath);
  }
  const manifest = validateReviewManifest(parsed, filePath);
  if (manifest.reviewId !== reviewId) {
    throw invalidManifest("The review manifest reviewId does not match the requested id", filePath);
  }
  if (!sameRealPath(manifest.knowledgeRoot, knowledgeRoot)) {
    throw invalidManifest("The review manifest knowledgeRoot does not match the trusted knowledge root", filePath);
  }
  return manifest;
}

export function validateReviewManifest(parsed: unknown, label: string): ReviewManifest {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidManifest("The review manifest must be a mapping", label);
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== REVIEW_SCHEMA) {
    throw invalidManifest(`The review manifest schema must be ${REVIEW_SCHEMA}`, label);
  }
  if (!isValidReviewId(record.reviewId)) {
    throw invalidManifest("reviewId must be 32 lowercase hex characters", label);
  }
  if (!REPOSITORY_ID_PATTERN.test(String(record.repositoryId ?? ""))) {
    throw invalidManifest("repositoryId must be llmdoc-<32 hex>", label);
  }
  if (!isFullOid(record.sourceRevision)) {
    throw invalidManifest("sourceRevision must be a full commit OID", label);
  }
  if (!isFullOid(record.knowledgeBaseRevision)) {
    throw invalidManifest("knowledgeBaseRevision must be a full commit OID", label);
  }
  if (!isNonEmptyString(record.sourceRoot) || !isNonEmptyString(record.knowledgeRoot)) {
    throw invalidManifest("sourceRoot and knowledgeRoot must be non-empty strings", label);
  }
  if (!isNonEmptyString(record.createdAt)) {
    throw invalidManifest("createdAt must be a non-empty string", label);
  }
  for (const flag of ["global", "advanceGlobalReview", "confirmed", "consumed"] as const) {
    if (typeof record[flag] !== "boolean") {
      throw invalidManifest(`${flag} must be a boolean`, label);
    }
  }
  for (const field of ["confirmedAt", "consumedAt"] as const) {
    if (record[field] !== null && !isNonEmptyString(record[field])) {
      throw invalidManifest(`${field} must be a string or null`, label);
    }
  }
  if (record.knowledgeRevision !== null && !isFullOid(record.knowledgeRevision)) {
    throw invalidManifest("knowledgeRevision must be a full commit OID or null", label);
  }
  if (!isStringArray(record.notes)) {
    throw invalidManifest("notes must be a string array", label);
  }
  if (!Array.isArray(record.documents)) {
    throw invalidManifest("documents must be an array", label);
  }
  const documents = record.documents.map((item, index) => validateManifestItem(item, `${label}#documents[${index}]`));
  const writeSet = validateWriteSet(record.writeSet, label);
  return {
    schema: REVIEW_SCHEMA,
    reviewId: record.reviewId,
    repositoryId: String(record.repositoryId),
    sourceRevision: record.sourceRevision as string,
    knowledgeBaseRevision: record.knowledgeBaseRevision as string,
    sourceRoot: record.sourceRoot as string,
    knowledgeRoot: record.knowledgeRoot as string,
    createdAt: record.createdAt as string,
    global: record.global as boolean,
    advanceGlobalReview: record.advanceGlobalReview as boolean,
    notes: [...(record.notes as string[])],
    documents,
    writeSet,
    confirmed: record.confirmed as boolean,
    confirmedAt: (record.confirmedAt as string | null) ?? null,
    consumed: record.consumed as boolean,
    consumedAt: (record.consumedAt as string | null) ?? null,
    knowledgeRevision: (record.knowledgeRevision as string | null) ?? null
  };
}

function validateManifestItem(input: unknown, label: string): ReviewDocumentItem {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalidManifest("Each document entry must be a mapping", label);
  }
  const item = input as Record<string, unknown>;
  if (!isCanonicalDocId(item.id)) {
    throw invalidManifest("document id must be a canonical docs-relative .md path", label);
  }
  if (!ACTIONS.includes(item.action as ReviewAction)) {
    throw invalidManifest("action must be add | update | refresh | delete", label);
  }
  if (item.oldDigest !== null && !isDigest(item.oldDigest)) {
    throw invalidManifest("oldDigest must be sha256:<64 hex> or null", label);
  }
  if (item.candidateDigest !== null && !isDigest(item.candidateDigest)) {
    throw invalidManifest("candidateDigest must be sha256:<64 hex> or null", label);
  }
  if (item.oldSourceRevision !== null && !isFullOid(item.oldSourceRevision)) {
    throw invalidManifest("oldSourceRevision must be a full commit OID or null", label);
  }
  const oldScope = validateScopeArray(item.oldScope, `${label}.oldScope`);
  const newScope = validateScopeArray(item.newScope, `${label}.newScope`);
  const removedScope = validateScopeArray(item.removedScope, `${label}.removedScope`);
  const oldValidatedRequires = validateRequiresRecord(item.oldValidatedRequires, `${label}.oldValidatedRequires`);
  const candidateRequires = validateCandidateRequires(item.candidateRequires, `${label}.candidateRequires`);
  if (!isStringArray(item.reasons)) {
    throw invalidManifest("reasons must be a string array", label);
  }
  if (!CONCLUSIONS.includes(item.proposedConclusion as ReviewConclusion)) {
    throw invalidManifest("proposedConclusion must be changed | unchanged | insufficient", label);
  }
  if (item.conclusion !== null && !CONCLUSIONS.includes(item.conclusion as ReviewConclusion)) {
    throw invalidManifest("conclusion must be changed | unchanged | insufficient | null", label);
  }
  return {
    id: item.id as string,
    action: item.action as ReviewAction,
    oldDigest: (item.oldDigest as string | null) ?? null,
    candidateDigest: (item.candidateDigest as string | null) ?? null,
    oldSourceRevision: (item.oldSourceRevision as string | null) ?? null,
    oldScope,
    newScope,
    removedScope,
    oldValidatedRequires,
    candidateRequires,
    reasons: [...(item.reasons as string[])],
    proposedConclusion: item.proposedConclusion as ReviewConclusion,
    conclusion: (item.conclusion as ReviewConclusion | null) ?? null
  };
}

function validateWriteSet(input: unknown, label: string): ReviewWriteSet {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalidManifest("writeSet must be a mapping", label);
  }
  const record = input as Record<string, unknown>;
  const documents = validateDocIdArray(record.documents, `${label}.writeSet.documents`);
  const refresh = validateDocIdArray(record.refresh, `${label}.writeSet.refresh`);
  const deletions = validateDocIdArray(record.deletions, `${label}.writeSet.deletions`);
  const candidates = validateCandidateIdArray(record.candidates, `${label}.writeSet.candidates`);
  if (typeof record.meta !== "boolean") {
    throw invalidManifest("writeSet.meta must be a boolean", label);
  }
  if (!Array.isArray(record.generated) || record.generated.some((entry) => !isSafeRelativePath(entry))) {
    throw invalidManifest("writeSet.generated must be an array of safe repository-relative paths", label);
  }
  return { documents, refresh, deletions, candidates, meta: record.meta, generated: [...(record.generated as string[])] };
}

function validateCandidateIdArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.some((entry) => !isInboxCandidateId(entry))) {
    throw invalidManifest("write set candidate entries must be inbox-relative .md candidate ids", label);
  }
  return [...(input as string[])];
}

function validateScopeArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.some((entry) => typeof entry !== "string" || canonicalizeSourcePath(entry) !== entry)) {
    throw invalidManifest("scope entries must be canonical repository-relative source paths", label);
  }
  return [...(input as string[])];
}

function validateDocIdArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.some((entry) => !isCanonicalDocId(entry))) {
    throw invalidManifest("write set entries must be canonical docs-relative .md paths", label);
  }
  return [...(input as string[])];
}

function validateRequiresRecord(input: unknown, label: string): Record<string, string> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalidManifest("validatedRequires must be a mapping", label);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isCanonicalDocId(key) || !isDigest(value)) {
      throw invalidManifest("validatedRequires keys must be canonical document ids and values sha256 digests", label);
    }
    result[key] = value as string;
  }
  return result;
}

function validateCandidateRequires(input: unknown, label: string): ReviewRequireBinding[] {
  if (!Array.isArray(input)) {
    throw invalidManifest("candidateRequires must be an array", label);
  }
  return input.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw invalidManifest("candidateRequires entries must be mappings", label);
    }
    const record = item as Record<string, unknown>;
    if (!isCanonicalDocId(record.id) || !isDigest(record.digest)) {
      throw invalidManifest("candidateRequires entries need a canonical id and sha256 digest", label);
    }
    return { id: record.id as string, digest: record.digest as string };
  });
}

function isCanonicalDocId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || !value.endsWith(".md") || value.includes("\\")) {
    return false;
  }
  if (value.startsWith("/") || value.startsWith("./") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && !normalized.split("/").includes("..") && normalized !== ".";
}

function isSafeRelativePath(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  const segments = value.replaceAll("\\", "/").split("/");
  return !segments.includes("..") && !segments.includes("");
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isFullOid(value: unknown): value is string {
  return typeof value === "string" && FULL_OID_PATTERN.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function invalidManifest(message: string, label: string): KnowledgeError {
  return new KnowledgeError("E_REVIEW_INVALID", message, {
    paths: [label],
    remediation: "Re-run `llmdoc review` to generate a fresh manifest; llmdoc never trusts manifest cache paths or identity."
  });
}

export interface ConfirmReviewOptions {
  overrides?: Record<string, ReviewConclusion>;
  now?: Date;
}

export function confirmReviewManifest(
  context: KnowledgeWriteContext,
  manifest: ReviewManifest,
  options: ConfirmReviewOptions = {}
): ReviewManifest {
  assertManifestMatchesContext(context, manifest);
  const overrides = options.overrides ?? {};
  for (const [id, conclusion] of Object.entries(overrides)) {
    if (!isConclusion(conclusion)) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Invalid semantic conclusion for ${id}: ${String(conclusion)}`, {
        paths: [id]
      });
    }
    if (!manifest.documents.some((item) => item.id === id)) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Cannot confirm ${id}: it is not a review candidate`, { paths: [id] });
    }
  }
  const items = manifest.documents.map((item) => ({
    ...item,
    conclusion: overrides[item.id] ?? item.conclusion ?? item.proposedConclusion
  }));
  const conclusions = new Map(items.map((item) => [item.id, item.conclusion as ReviewConclusion]));
  const withRequires = attachCandidateRequires(context, items, conclusions);
  const writeSet = deriveWriteSet(withRequires, conclusions, manifest.advanceGlobalReview, context);
  return {
    ...manifest,
    // Trust the freshly resolved binding/revisions, never the manifest cache values.
    repositoryId: context.entry.repositoryId,
    sourceRoot: context.source.worktreeRoot,
    knowledgeRoot: context.knowledge.worktreeRoot,
    sourceRevision: context.source.headRevision!,
    knowledgeBaseRevision: context.knowledgeHead!,
    documents: withRequires,
    writeSet,
    confirmed: true,
    confirmedAt: (options.now ?? new Date()).toISOString()
  };
}

function assertManifestMatchesContext(context: KnowledgeWriteContext, manifest: ReviewManifest): void {
  if (manifest.repositoryId !== context.entry.repositoryId) {
    throw new KnowledgeError("E_SOURCE_IDENTITY_MISMATCH", "The review manifest belongs to a different repository identity", {
      paths: [manifest.repositoryId, context.entry.repositoryId]
    });
  }
  if (!sameRealPath(manifest.sourceRoot, context.source.worktreeRoot)) {
    throw invalidManifest("The review manifest sourceRoot does not match the bound source worktree", manifest.sourceRoot);
  }
  if (!sameRealPath(manifest.knowledgeRoot, context.knowledge.worktreeRoot)) {
    throw invalidManifest("The review manifest knowledgeRoot does not match the bound knowledge root", manifest.knowledgeRoot);
  }
  if (context.source.headRevision === null) {
    throw new KnowledgeError("E_SOURCE_INVALID_HEAD", "Confirming a review requires a valid source HEAD", {
      exitCode: 3,
      paths: [context.source.worktreeRoot]
    });
  }
  if (manifest.sourceRevision !== context.source.headRevision) {
    throw new KnowledgeError("E_SOURCE_HEAD_DRIFT", "The source HEAD changed since the review manifest was generated", {
      exitCode: 3,
      paths: [context.source.headRevision, manifest.sourceRevision],
      remediation: "Re-run `llmdoc review` against the new source revision."
    });
  }
  if (context.knowledgeHead === null || manifest.knowledgeBaseRevision !== context.knowledgeHead) {
    throw new KnowledgeError("E_KNOWLEDGE_HEAD_MISMATCH", "The knowledge HEAD does not match the manifest K0", {
      exitCode: 3,
      paths: [context.knowledgeHead ?? "null", manifest.knowledgeBaseRevision],
      remediation: "Re-run `llmdoc review`; the knowledge branch moved."
    });
  }
}

export function markReviewConsumed(manifest: ReviewManifest, knowledgeRevision: string, now = new Date()): ReviewManifest {
  return {
    ...manifest,
    consumed: true,
    consumedAt: now.toISOString(),
    knowledgeRevision
  };
}

function isConclusion(value: unknown): value is ReviewConclusion {
  return value === "changed" || value === "unchanged" || value === "insufficient";
}

export type { KnowledgeMeta, KnowledgeSnapshot, KnowledgeModel };
