import fs from "node:fs";
import path from "node:path";

import { KnowledgeError } from "./errors.js";
import { isKnowledgeKind, KNOWLEDGE_KINDS, renderKnowledgeDocumentContent, type KnowledgeKind } from "./document.js";
import {
  isInboxCandidateId,
  listWorktreeInboxIds,
  readCommittedCandidates,
  readWorktreeCandidate,
  type InboxCandidate
} from "./inbox.js";
import { buildKnowledgeModelFromRaw, type KnowledgeRawEntry } from "./knowledge-model.js";
import { withKnowledgeLock } from "./lock.js";
import { navigationChanged } from "./navigation.js";
import { resolveWriteBinding } from "./binding.js";
import {
  buildReviewManifest,
  writeReviewManifest,
  type ReviewManifest,
  type ReviewWriteSet
} from "./review.js";
import { assertReviewPreconditions, resolveKnowledgeWriteContext, type KnowledgeWriteContext } from "./write-context.js";

export interface PromoteRequest {
  candidate: string;
  to: string;
  kind: string;
  description: string;
  sourcePaths: string[];
  requires?: string[];
  related?: string[];
  supersedes?: string[];
}

export interface UpdateTestHooks {
  /** Injected failure seam right after the worktree mutations are applied; must roll back. */
  afterApply?: () => void | Promise<void>;
}

export interface UpdateOptions {
  sourceInput: string;
  knowledgeInput?: string;
  nested?: boolean;
  registryDir?: string;
  promote?: PromoteRequest;
  reject?: string[];
  prepare?: boolean;
  global?: boolean;
  testHooks?: UpdateTestHooks;
}

export interface UpdateCandidateSummary {
  id: string;
  title: string | null;
  capturedAt: string | null;
  sourceRevision: string | null;
  note: string | null;
  committed: boolean;
}

export interface UpdateResult {
  schema: "llmdoc.update/v1";
  status: "reported" | "prepared";
  repositoryId: string;
  sourceRevision: string | null;
  knowledgeRevision: string | null;
  candidates: UpdateCandidateSummary[];
  promotions: Array<{ candidate: string; document: string }>;
  rejections: string[];
  navigationChanged: boolean;
  reviewId: string | null;
  writeSet: ReviewWriteSet | null;
  cleanupRequired: boolean;
  sync: { index: "synced" | "failed" | "skipped"; files: Array<{ path: string; synced: boolean }>; errors: string[] };
}

/**
 * Update is orchestration, not a transaction: it applies explicit human/Agent decisions to
 * the worktree (promote a candidate into a canonical document, or reject it) and then forms
 * an *unconfirmed* Review Manifest. It never marks anything current and never commits; the
 * single publication path remains `commit --review`/seal. All physical atomicity (docs +
 * relations + meta + candidate removal in one K1) is therefore inherited from seal.
 */
export async function runUpdateWorkflow(options: UpdateOptions): Promise<UpdateResult> {
  const binding = await resolveWriteBinding({
    sourceInput: options.sourceInput,
    knowledgeInput: options.knowledgeInput,
    nested: options.nested,
    registryDir: options.registryDir
  });
  return withKnowledgeLock(binding.knowledge.commonDir, async () => {
    const context = await resolveKnowledgeWriteContext({
      sourceInput: options.sourceInput,
      knowledgeInput: options.knowledgeInput,
      nested: options.nested,
      registryDir: options.registryDir
    });
    return updateLocked(context, options);
  });
}

async function updateLocked(context: KnowledgeWriteContext, options: UpdateOptions): Promise<UpdateResult> {
  const promotions = options.promote ? [options.promote] : [];
  const rejections = options.reject ?? [];
  const mutations = promotions.length + rejections.length;
  const prepare = mutations > 0 || options.prepare === true;

  // Validate everything before touching the worktree, then apply once and roll back if any
  // later step (fresh reload, preconditions, manifest) fails. A validation failure therefore
  // leaves the worktree, candidate, HEAD and index bytes completely unchanged.
  if (mutations > 0) {
    await assertReviewPreconditions(context);
    await validateRequests(context, promotions, rejections);
  }
  const rollback = mutations > 0 ? applyMutations(context, promotions, rejections) : null;

  try {
    if (mutations > 0 && options.testHooks?.afterApply) {
      await options.testHooks.afterApply();
    }
    const fresh = mutations > 0 ? await resolveKnowledgeWriteContext({
      sourceInput: options.sourceInput,
      knowledgeInput: options.knowledgeInput,
      nested: options.nested,
      registryDir: options.registryDir
    }) : context;

    const candidates = await summarizeCandidates(fresh);
    let manifest: ReviewManifest | null = null;
    if (prepare) {
      await assertReviewPreconditions(fresh);
      manifest = buildReviewManifest(fresh, { global: options.global === true });
      writeReviewManifest(fresh.knowledge.worktreeRoot, manifest);
    }

    const navigation = navigationChanged(fresh);

    return {
      schema: "llmdoc.update/v1",
      status: prepare ? "prepared" : "reported",
      repositoryId: fresh.entry.repositoryId,
      sourceRevision: fresh.source.headRevision,
      knowledgeRevision: fresh.knowledgeHead,
      candidates,
      promotions: promotions.map((promotion) => ({ candidate: promotion.candidate, document: promotion.to })),
      rejections: [...rejections].sort(),
      navigationChanged: navigation,
      reviewId: manifest?.reviewId ?? null,
      writeSet: manifest?.writeSet ?? null,
      cleanupRequired: false,
      sync: { index: "skipped", files: [], errors: [] }
    };
  } catch (error) {
    rollback?.();
    throw error;
  }
}

async function summarizeCandidates(context: KnowledgeWriteContext): Promise<UpdateCandidateSummary[]> {
  const committed = await readCommittedCandidates(context);
  const committedIds = new Set(committed.map((candidate) => candidate.id));
  const summaries: UpdateCandidateSummary[] = committed.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    capturedAt: candidate.capturedAt,
    sourceRevision: candidate.sourceRevision,
    note: candidate.note,
    committed: true
  }));
  for (const id of listWorktreeInboxIds(context.knowledge.worktreeRoot)) {
    if (committedIds.has(id)) {
      continue;
    }
    let candidate: InboxCandidate;
    try {
      candidate = readWorktreeCandidate(context.knowledge.worktreeRoot, id);
    } catch {
      continue;
    }
    summaries.push({
      id: candidate.id,
      title: candidate.title,
      capturedAt: candidate.capturedAt,
      sourceRevision: candidate.sourceRevision,
      note: candidate.note,
      committed: false
    });
  }
  return summaries.sort((left, right) => left.id.localeCompare(right.id));
}

async function validateRequests(context: KnowledgeWriteContext, promotions: PromoteRequest[], rejections: string[]): Promise<void> {
  // Only a clean K0-committed candidate may be promoted or rejected. An uncommitted
  // inbox draft is listed for review but is never consumed: deleting it would silently
  // destroy the recorder's work before it is reviewed.
  const committedRaw = new Map((await readCommittedCandidates(context)).map((candidate) => [candidate.id, candidate.raw]));
  const seen = new Set<string>();
  for (const candidate of [...promotions.map((promotion) => promotion.candidate), ...rejections]) {
    if (!isInboxCandidateId(candidate)) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Invalid inbox candidate id: ${candidate}`, { paths: [candidate] });
    }
    if (seen.has(candidate)) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Candidate referenced twice in one update: ${candidate}`, { paths: [candidate] });
    }
    seen.add(candidate);
    const filePath = path.join(context.knowledge.worktreeRoot, "inbox", candidate);
    if (!fs.existsSync(filePath)) {
      throw new KnowledgeError("E_KNOWLEDGE_DOC_NOT_FOUND", `Inbox candidate does not exist: ${candidate}`, {
        paths: [candidate],
        remediation: "List candidates with `llmdoc update`, then reject or promote an existing candidate."
      });
    }
    if (!committedRaw.has(candidate)) {
      throw new KnowledgeError(
        "E_CANDIDATE_UNCOMMITTED",
        `Inbox candidate ${candidate} is an uncommitted draft and cannot be promoted or rejected`,
        {
          exitCode: 2,
          paths: [candidate],
          remediation: "Commit the candidate with `llmdoc capture` first, or leave the draft untouched; update never consumes uncommitted drafts."
        }
      );
    }
    const worktreeRaw = fs.readFileSync(filePath, "utf8");
    if (worktreeRaw !== committedRaw.get(candidate)) {
      throw new KnowledgeError(
        "E_CANDIDATE_UNCOMMITTED",
        `Inbox candidate ${candidate} has uncommitted edits and cannot be promoted or rejected`,
        {
          exitCode: 2,
          paths: [candidate],
          remediation: "Commit or revert the candidate edits first; update never consumes a modified draft."
        }
      );
    }
  }
  const targets = new Set<string>();
  for (const promotion of promotions) {
    if (!isKnowledgeKind(promotion.kind)) {
      throw new KnowledgeError("E_INVALID_KIND", `Invalid kind for ${promotion.to}: ${promotion.kind}. Allowed: ${KNOWLEDGE_KINDS.join(", ")}`, {
        paths: [promotion.to]
      });
    }
    if (promotion.description.trim().length === 0) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Promotion of ${promotion.candidate} requires a non-empty description`, {
        paths: [promotion.to]
      });
    }
    if (promotion.sourcePaths.length === 0) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Promotion of ${promotion.candidate} requires at least one --source-path`, {
        paths: [promotion.to]
      });
    }
    if (!isCanonicalDocId(promotion.to)) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Promotion target must be a canonical docs-relative .md id: ${promotion.to}`, {
        paths: [promotion.to]
      });
    }
    if (targets.has(promotion.to)) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Two promotions target the same document in one update: ${promotion.to}`, {
        paths: [promotion.to]
      });
    }
    targets.add(promotion.to);
    // Fail closed: promotion never overwrites an existing canonical document or an
    // uncommitted human draft. The frozen protocol has no implicit replace operation.
    if (
      context.worktreeModel.byId.has(promotion.to) ||
      context.k0Model.byId.has(promotion.to) ||
      fs.existsSync(path.join(context.knowledge.docsRoot, promotion.to))
    ) {
      throw new KnowledgeError("E_DOCUMENT_EXISTS", `Promotion target already exists and will not be overwritten: ${promotion.to}`, {
        exitCode: 2,
        paths: [promotion.to],
        remediation: "Choose a new document id, or edit the existing document through an explicit review; update never replaces content implicitly."
      });
    }
  }

  validateProjectedStructure(context, promotions);
}

/**
 * Builds the post-promotion knowledge model entirely in memory and rejects any structural
 * error (invalid source scope, missing/self/cyclic relations, supersedes target kind, body
 * links). Only a fully valid projection is allowed to reach the worktree.
 */
function validateProjectedStructure(context: KnowledgeWriteContext, promotions: PromoteRequest[]): void {
  const promotedTargets = new Set(promotions.map((promotion) => promotion.to));
  const entries: KnowledgeRawEntry[] = context.worktree.entries.filter((entry) => !promotedTargets.has(entry.id));
  for (const promotion of promotions) {
    const candidate = readWorktreeCandidate(context.knowledge.worktreeRoot, promotion.candidate);
    const content = renderKnowledgeDocumentContent({
      kind: promotion.kind as KnowledgeKind,
      description: promotion.description,
      sourcePaths: promotion.sourcePaths,
      requires: promotion.requires,
      related: promotion.related,
      supersedes: promotion.supersedes,
      body: candidate.body
    });
    entries.push({ id: promotion.to, raw: content, absolutePath: path.join(context.knowledge.docsRoot, promotion.to) });
  }
  const projected = buildKnowledgeModelFromRaw(entries, context.knowledge.docsRoot);
  const errors = projected.issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) {
    return;
  }
  const codes = [...new Set(errors.map((issue) => issue.code))];
  throw new KnowledgeError(
    "E_STRUCTURE_INVALID",
    `Promotion would produce a structurally invalid knowledge worktree: ${codes.join(", ")}`,
    {
      exitCode: 2,
      paths: [...new Set(errors.map((issue) => issue.path))],
      remediation: "Fix the promoted document's source scope, relations (existence/type/cycle) or body links before promoting."
    }
  );
}

/**
 * Applies all validated mutations in one pass and returns a rollback that restores the
 * exact pre-mutation worktree bytes. Promotion creates the target with `wx` (never
 * overwrites); rejection backs up the candidate bytes before removing it. If any write
 * fails midway, the partial changes are rolled back before the error propagates.
 */
function applyMutations(context: KnowledgeWriteContext, promotions: PromoteRequest[], rejections: string[]): () => void {
  const created: string[] = [];
  const removed: Array<{ path: string; raw: Buffer }> = [];
  const rollback = (): void => {
    for (const entry of removed) {
      try {
        fs.mkdirSync(path.dirname(entry.path), { recursive: true });
        fs.writeFileSync(entry.path, entry.raw);
      } catch {
        // best-effort restore
      }
    }
    for (const target of created) {
      try {
        fs.rmSync(target, { force: true });
      } catch {
        // best-effort restore
      }
    }
  };

  try {
    for (const promotion of promotions) {
      const candidate = readWorktreeCandidate(context.knowledge.worktreeRoot, promotion.candidate);
      const content = renderKnowledgeDocumentContent({
        kind: promotion.kind as KnowledgeKind,
        description: promotion.description,
        sourcePaths: promotion.sourcePaths,
        requires: promotion.requires,
        related: promotion.related,
        supersedes: promotion.supersedes,
        body: candidate.body
      });
      const target = path.join(context.knowledge.docsRoot, promotion.to);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { flag: "wx" });
      created.push(target);
      // Promotion consumes the candidate: the removal is published atomically with the new
      // document, its relations and the refreshed meta by the later seal.
      const consumedPath = path.join(context.knowledge.worktreeRoot, "inbox", promotion.candidate);
      removed.push({ path: consumedPath, raw: fs.readFileSync(consumedPath) });
      fs.rmSync(consumedPath, { force: true });
    }
    for (const candidate of rejections) {
      const filePath = path.join(context.knowledge.worktreeRoot, "inbox", candidate);
      const raw = fs.readFileSync(filePath);
      removed.push({ path: filePath, raw });
      fs.rmSync(filePath, { force: true });
    }
  } catch (error) {
    rollback();
    throw new KnowledgeError("E_FILESYSTEM_IO", `Failed to apply update mutations: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [],
      remediation: "The knowledge worktree was rolled back to its pre-update bytes; re-run the update."
    });
  }
  return rollback;
}

function isCanonicalDocId(value: string): boolean {
  if (value.length === 0 || !value.endsWith(".md") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && !normalized.split("/").includes("..") && normalized !== ".";
}
