import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { KnowledgeError, runFileSystemIo } from "./errors.js";
import { buildKnowledgeModelFromRaw, relationsFor, type KnowledgeModel, type KnowledgeRawEntry } from "./knowledge-model.js";
import { isInboxCandidateId, listWorktreeInboxIds } from "./inbox.js";
import { readNavigationRegion, readReadme, renderNavigation } from "./navigation.js";
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

/** The minimal per-document facts a full-batch projection needs; no candidate requires yet. */
export interface ReviewObservedDocument {
  id: string;
  action: ReviewAction;
  oldDigest: string | null;
  candidateDigest: string | null;
  oldSourceRevision: string | null;
  oldScope: string[];
  newScope: string[];
  removedScope: string[];
  oldValidatedRequires: Record<string, string>;
  reasons: string[];
  proposedConclusion: ReviewConclusion;
}

export interface ReviewDocumentItem extends ReviewObservedDocument {
  candidateRequires: ReviewRequireBinding[];
  conclusion: ReviewConclusion | null;
}

/**
 * One read of the current knowledge state, carrying only what projection needs. The maps
 * are freshly built here and exposed through read-only types, so projection cannot mutate
 * context-owned state; no README or inbox candidate body content enters the projection.
 */
export interface ReviewObservation {
  documents: readonly ReviewObservedDocument[];
  docsRoot: string;
  /** Candidate digest of every formal worktree document, keyed by id. */
  worktreeDigests: ReadonlyMap<string, string>;
  /** Immutable-by-convention raw snapshots used to select and validate the exact K1 tree. */
  k0Documents: readonly KnowledgeRawEntry[];
  worktreeDocuments: readonly KnowledgeRawEntry[];
  /** Committed inbox candidates consumed by this batch (promotion or rejection). */
  removedCandidates: readonly string[];
  /** Only the machine-managed README region; human-owned bytes stay outside projection. */
  navigationRegion: string | null;
}

export interface ReviewProjectedDocument extends ReviewObservedDocument {
  conclusion: ReviewConclusion;
  candidateRequires: ReviewRequireBinding[];
}

/** The final full-batch projection shared by manifests and publication materialization. */
export interface ReviewProjection {
  documents: ReviewProjectedDocument[];
  writeSet: ReviewWriteSet;
  renderedNavigation: string;
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
  const observation = observeReview(context);
  const proposed = new Map(observation.documents.map((item) => [item.id, item.proposedConclusion]));
  const projection = projectReview(observation, proposed, options.global === true);
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
    // The provisional projection drives the stored candidate requires and write set, but an
    // unconfirmed manifest never persists a semantic conclusion.
    documents: projection.documents.map((item) => ({ ...item, conclusion: null })),
    writeSet: projection.writeSet,
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
 * Reads the current knowledge state once and returns only the facts a full-batch projection
 * needs. The maps are freshly built here and exposed through read-only types so projection
 * cannot mutate context-owned state.
 */
export function observeReview(context: KnowledgeWriteContext): ReviewObservation {
  const documents: ReviewObservedDocument[] = buildReviewItems(context, {}).map((item) => ({
    id: item.id,
    action: item.action,
    oldDigest: item.oldDigest,
    candidateDigest: item.candidateDigest,
    oldSourceRevision: item.oldSourceRevision,
    oldScope: [...item.oldScope],
    newScope: [...item.newScope],
    removedScope: [...item.removedScope],
    oldValidatedRequires: { ...item.oldValidatedRequires },
    reasons: [...item.reasons],
    proposedConclusion: item.proposedConclusion
  }));
  const worktreeDigests = new Map<string, string>();
  for (const document of context.worktreeModel.documents) {
    worktreeDigests.set(document.id, document.contentDigest);
  }
  const readme = readReadme(context.knowledge.worktreeRoot);
  return {
    documents,
    docsRoot: context.knowledge.docsRoot,
    worktreeDigests,
    k0Documents: context.k0.entries.map((entry) => ({ ...entry })),
    worktreeDocuments: context.worktree.entries.map((entry) => ({ ...entry })),
    removedCandidates: computeRemovedCandidates(context),
    navigationRegion: readNavigationRegion(readme ?? "")
  };
}

/**
 * Pure, I/O-free full-batch projection. One `finalDigests` calculation feeds both the
 * candidate requires bindings and the write set, so a per-document helper can never
 * recompute a different answer than the batch it was confirmed in.
 */
export function projectReview(
  observation: ReviewObservation,
  conclusions: ReadonlyMap<string, ReviewConclusion>,
  global: boolean
): ReviewProjection {
  const finalDigests = computeFinalDigests(observation, conclusions);
  const documents = observation.documents.map((item): ReviewProjectedDocument => ({
    ...item,
    conclusion: conclusions.get(item.id) ?? item.proposedConclusion,
    candidateRequires: []
  }));
  const finalModel = buildProjectedKnowledgeModel(observation, documents);
  for (const item of documents) {
    const candidateRequires: ReviewRequireBinding[] = [];
    for (const target of relationsFor(finalModel, item.id).requires) {
      const digest = finalDigests.get(target);
      if (digest !== undefined && digest !== null) {
        candidateRequires.push({ id: target, digest });
      }
    }
    item.candidateRequires = candidateRequires;
  }
  const renderedNavigation = renderNavigation(finalModel);
  const writeSet = deriveWriteSet(
    documents,
    observation,
    global,
    observation.navigationRegion !== renderedNavigation
  );
  return { documents, writeSet, renderedNavigation };
}

function buildProjectedKnowledgeModel(
  observation: ReviewObservation,
  documents: readonly ReviewProjectedDocument[]
): KnowledgeModel {
  const projectedById = new Map(documents.map((item) => [item.id, item]));
  const k0ById = new Map(observation.k0Documents.map((entry) => [entry.id, entry]));
  const worktreeById = new Map(observation.worktreeDocuments.map((entry) => [entry.id, entry]));
  const ids = new Set([...k0ById.keys(), ...worktreeById.keys()]);
  const entries: KnowledgeRawEntry[] = [];
  for (const id of [...ids].sort()) {
    const item = projectedById.get(id);
    const entry =
      item?.conclusion === "insufficient"
        ? k0ById.get(id)
        : item?.action === "delete"
          ? undefined
          : worktreeById.get(id);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  const model = buildKnowledgeModelFromRaw(entries, observation.docsRoot);
  const errors = model.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    const codes = [...new Set(errors.map((issue) => issue.code))];
    throw new KnowledgeError(
      "E_STRUCTURE_INVALID",
      `The review conclusions would publish structurally invalid knowledge: ${codes.join(", ")}`,
      {
        exitCode: 2,
        paths: [...new Set(errors.map((issue) => issue.path))],
        remediation: "Change the review conclusions so the final document set has no missing links, invalid relations or cycles."
      }
    );
  }
  return model;
}

function computeFinalDigests(
  observation: ReviewObservation,
  conclusions: ReadonlyMap<string, ReviewConclusion>
): Map<string, string | null> {
  const finalDigests = new Map<string, string | null>(observation.worktreeDigests);
  for (const item of observation.documents) {
    const conclusion = conclusions.get(item.id) ?? item.proposedConclusion;
    if (conclusion === "insufficient" || item.action === "refresh") {
      // Not advanced, or the body is byte-identical to K0: the committed digest stays K0's.
      finalDigests.set(item.id, item.oldDigest);
    } else if (item.action === "delete") {
      finalDigests.set(item.id, null);
    } else {
      // add/update: the candidate bytes are physically written to K1.
      finalDigests.set(item.id, item.candidateDigest);
    }
  }
  return finalDigests;
}

function deriveWriteSet(
  documents: readonly ReviewProjectedDocument[],
  observation: ReviewObservation,
  global: boolean,
  navigationChanged: boolean
): ReviewWriteSet {
  const written: string[] = [];
  const refresh: string[] = [];
  const deletions: string[] = [];
  for (const item of documents) {
    if (item.conclusion === "insufficient") {
      continue;
    }
    // The physical write set is determined by the candidate's byte/path action relative
    // to K0, never by the semantic conclusion label: add/update must be written, delete
    // must be removed, refresh is a physical no-op. `insufficient` is the only no-advance.
    if (item.action === "delete") {
      deletions.push(item.id);
    } else if (item.action === "add" || item.action === "update") {
      written.push(item.id);
    } else {
      refresh.push(item.id);
    }
  }
  const candidates = [...observation.removedCandidates];
  // Navigation is only regenerated when the document set or bytes actually change; a
  // pure meta-only refresh or a global-review advance must not fabricate a README commit.
  const contentChange = written.length + deletions.length + candidates.length > 0;
  const navigation = contentChange && navigationChanged;
  const meta = written.length + refresh.length + deletions.length + candidates.length > 0 || global;
  const generated: string[] = [];
  if (meta) {
    generated.push(".llmdoc/meta.json");
  }
  if (navigation) {
    generated.push("README.md");
  }
  return {
    documents: written.sort(),
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
  assertUnique(
    documents.map((item) => item.id),
    "document ids must be unique",
    label
  );
  const confirmed = record.confirmed as boolean;
  const confirmedAt = (record.confirmedAt as string | null) ?? null;
  const consumed = record.consumed as boolean;
  const consumedAt = (record.consumedAt as string | null) ?? null;
  const knowledgeRevision = (record.knowledgeRevision as string | null) ?? null;
  for (const item of documents) {
    if (confirmed && item.conclusion === null) {
      throw invalidManifest("confirmed manifests must record a conclusion for every document", label);
    }
    if (!confirmed && item.conclusion !== null) {
      throw invalidManifest("unconfirmed manifests must not record conclusions", label);
    }
  }
  if (confirmed && confirmedAt === null) {
    throw invalidManifest("confirmed manifests must record confirmedAt", label);
  }
  if (!confirmed && confirmedAt !== null) {
    throw invalidManifest("unconfirmed manifests must not record confirmedAt", label);
  }
  if (consumed && !confirmed) {
    throw invalidManifest("consumed manifests must be confirmed", label);
  }
  if (consumed && (consumedAt === null || knowledgeRevision === null)) {
    throw invalidManifest("consumed manifests must record consumedAt and knowledgeRevision", label);
  }
  if (!consumed && (consumedAt !== null || knowledgeRevision !== null)) {
    throw invalidManifest("unconsumed manifests must not record consumedAt or knowledgeRevision", label);
  }
  if (record.global !== record.advanceGlobalReview) {
    throw invalidManifest(`llmdoc.review/v1 requires global and advanceGlobalReview to be equal`, label);
  }
  const writeSet = validateWriteSet(record.writeSet, label, new Set(documents.map((item) => item.id)));
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
    confirmed,
    confirmedAt,
    consumed,
    consumedAt,
    knowledgeRevision
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
  assertUnique(oldScope, "oldScope entries must be unique", label);
  assertUnique(newScope, "newScope entries must be unique", label);
  assertUnique(removedScope, "removedScope entries must be unique", label);
  const oldValidatedRequires = validateRequiresRecord(item.oldValidatedRequires, `${label}.oldValidatedRequires`);
  const candidateRequires = validateCandidateRequires(item.candidateRequires, `${label}.candidateRequires`);
  assertUnique(
    candidateRequires.map((binding) => binding.id),
    "candidateRequires ids must be unique",
    label
  );
  if (!isStringArray(item.reasons)) {
    throw invalidManifest("reasons must be a string array", label);
  }
  assertUnique(item.reasons as string[], "reasons must be unique", label);
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

function validateWriteSet(input: unknown, label: string, declaredDocumentIds: ReadonlySet<string>): ReviewWriteSet {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalidManifest("writeSet must be a mapping", label);
  }
  const record = input as Record<string, unknown>;
  const documents = validateDocIdArray(record.documents, `${label}.writeSet.documents`);
  const refresh = validateDocIdArray(record.refresh, `${label}.writeSet.refresh`);
  const deletions = validateDocIdArray(record.deletions, `${label}.writeSet.deletions`);
  const candidates = validateCandidateIdArray(record.candidates, `${label}.writeSet.candidates`);
  assertUnique(documents, "writeSet.documents must not contain duplicates", label);
  assertUnique(refresh, "writeSet.refresh must not contain duplicates", label);
  assertUnique(deletions, "writeSet.deletions must not contain duplicates", label);
  assertUnique(candidates, "writeSet.candidates must not contain duplicates", label);
  const written = new Set(documents);
  for (const id of refresh) {
    if (written.has(id)) {
      throw invalidManifest("writeSet.documents and writeSet.refresh must be disjoint", label);
    }
  }
  const refreshed = new Set(refresh);
  for (const id of deletions) {
    if (written.has(id) || refreshed.has(id)) {
      throw invalidManifest("writeSet.deletions must be disjoint from the other document lists", label);
    }
  }
  for (const id of [...documents, ...refresh, ...deletions]) {
    if (!declaredDocumentIds.has(id)) {
      throw invalidManifest(`write set references an undeclared document id: ${id}`, label);
    }
  }
  if (typeof record.meta !== "boolean") {
    throw invalidManifest("writeSet.meta must be a boolean", label);
  }
  if (!Array.isArray(record.generated) || record.generated.some((entry) => !isSafeRelativePath(entry))) {
    throw invalidManifest("writeSet.generated must be an array of safe repository-relative paths", label);
  }
  const generated = [...(record.generated as string[])];
  assertUnique(generated, "writeSet.generated must not contain duplicates", label);
  for (const entry of generated) {
    if (entry !== ".llmdoc/meta.json" && entry !== "README.md") {
      throw invalidManifest("writeSet.generated may only contain .llmdoc/meta.json and README.md", label);
    }
  }
  if (!record.meta && generated.length > 0) {
    throw invalidManifest("writeSet.meta=false forbids generated files", label);
  }
  if (record.meta && !generated.includes(".llmdoc/meta.json")) {
    throw invalidManifest("writeSet.meta=true requires .llmdoc/meta.json in generated", label);
  }
  return { documents, refresh, deletions, candidates, meta: record.meta, generated };
}

function assertUnique(values: readonly string[], message: string, label: string): void {
  if (new Set(values).size !== values.length) {
    throw invalidManifest(message, label);
  }
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

/**
 * Compares a fresh observation against the stored manifest documents by unique document id.
 * Both directions are exact: a candidate that appeared or disappeared since the manifest was
 * generated invalidates it. Set-valued fields compare as sets and requires evidence as an
 * id→digest map. The manifest must have passed the validator, so duplicate entries cannot
 * silently normalize here.
 */
export function assertReviewObservationMatches(observation: ReviewObservation, manifest: ReviewManifest): void {
  const observedById = new Map(observation.documents.map((item) => [item.id, item]));
  const manifestById = new Map(manifest.documents.map((item) => [item.id, item]));
  for (const item of observation.documents) {
    if (!manifestById.has(item.id)) {
      throw invalidated(`Unreviewed knowledge content appeared after the review: ${item.id}`, [item.id]);
    }
  }
  for (const item of manifest.documents) {
    const current = observedById.get(item.id);
    if (current === undefined) {
      throw invalidated(`Reviewed document no longer matches the review candidate set: ${item.id}`, [item.id]);
    }
    if (
      current.action !== item.action ||
      current.oldDigest !== item.oldDigest ||
      current.candidateDigest !== item.candidateDigest ||
      current.oldSourceRevision !== item.oldSourceRevision ||
      current.proposedConclusion !== item.proposedConclusion ||
      !sameStringSet(current.oldScope, item.oldScope) ||
      !sameStringSet(current.newScope, item.newScope) ||
      !sameStringSet(current.removedScope, item.removedScope) ||
      !sameStringSet(current.reasons, item.reasons) ||
      !sameDigestMap(current.oldValidatedRequires, item.oldValidatedRequires)
    ) {
      throw invalidated(`Reviewed document drifted after confirmation: ${item.id}`, [item.id]);
    }
  }
}

/**
 * Compares a projected batch (candidate requires + write set) against the manifest.
 * Ordering carries no protocol meaning: arrays compare as sets and bindings as id→digest
 * maps, so only real membership, digest, reason or scalar changes invalidate.
 */
export function assertReviewProjectionMatches(projection: ReviewProjection, manifest: ReviewManifest): void {
  const manifestById = new Map(manifest.documents.map((item) => [item.id, item]));
  for (const item of projection.documents) {
    const stored = manifestById.get(item.id);
    if (stored === undefined) {
      throw invalidated(`Projected document is missing from the manifest: ${item.id}`, [item.id]);
    }
    if (!sameDigestMap(bindingDigests(item.candidateRequires), bindingDigests(stored.candidateRequires))) {
      throw invalidated(`Dependency digests drifted for ${item.id}`, [item.id]);
    }
  }
  const projected = projection.writeSet;
  const stored = manifest.writeSet;
  if (
    projected.meta !== stored.meta ||
    !sameStringSet(projected.documents, stored.documents) ||
    !sameStringSet(projected.refresh, stored.refresh) ||
    !sameStringSet(projected.deletions, stored.deletions) ||
    !sameStringSet(projected.candidates, stored.candidates) ||
    !sameStringSet(projected.generated, stored.generated)
  ) {
    throw invalidated("The review write set drifted after confirmation", stored.documents);
  }
}

function bindingDigests(bindings: readonly ReviewRequireBinding[]): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const binding of bindings) {
    digests[binding.id] = binding.digest;
  }
  return digests;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const values = new Set(left);
  return right.every((entry) => values.has(entry));
}

function sameDigestMap(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  return leftKeys.every((key) => right[key] === left[key]);
}

function invalidated(message: string, paths: string[]): KnowledgeError {
  return new KnowledgeError("E_REVIEW_INVALIDATED", message, {
    exitCode: 3,
    paths,
    remediation: "Re-run `llmdoc review` so the manifest matches the current knowledge and source state."
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
  // The comparator below indexes documents, requires and the write set, so the validator
  // must reject duplicate or undeclared entries before any Set/Map is built from input.
  validateReviewManifest(manifest, "(review manifest)");
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
  const observation = observeReview(context);
  assertReviewObservationMatches(observation, manifest);
  // An unconfirmed manifest stores the provisional projection; an already confirmed
  // manifest stores its declared conclusions. Recompute exactly that state and compare
  // before accepting any new user conclusions, so worktree/requires/inbox/README drift
  // since generation is rejected at confirmation instead of at seal.
  const previous = new Map(manifest.documents.map((item) => [item.id, item.conclusion ?? item.proposedConclusion]));
  assertReviewProjectionMatches(projectReview(observation, previous, manifest.global), manifest);

  const userConclusions = new Map(
    manifest.documents.map((item) => [item.id, overrides[item.id] ?? item.conclusion ?? item.proposedConclusion])
  );
  const confirmedProjection = projectReview(observation, userConclusions, manifest.global);
  return {
    ...manifest,
    // Trust the freshly resolved binding/revisions, never the manifest cache values.
    repositoryId: context.entry.repositoryId,
    sourceRoot: context.source.worktreeRoot,
    knowledgeRoot: context.knowledge.worktreeRoot,
    sourceRevision: context.source.headRevision!,
    knowledgeBaseRevision: context.knowledgeHead!,
    documents: confirmedProjection.documents,
    writeSet: confirmedProjection.writeSet,
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
