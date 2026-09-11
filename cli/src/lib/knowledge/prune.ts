import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { KnowledgeError } from "./errors.js";
import { estimateTokens, resolveDocLink } from "../markdown.js";
import { FRAGMENT_TOKEN_THRESHOLD } from "../constants.js";
import { readGitBlobs } from "./git-core.js";
import { normalizeDocTarget } from "./knowledge-model.js";
import { normalizeKnowledgeContent, type KnowledgeDocument } from "./document.js";
import { withKnowledgeLock } from "./lock.js";
import { resolveWriteBinding } from "./binding.js";
import { buildReviewManifest, writeReviewManifest, type ReviewWriteSet } from "./review.js";
import { assertReviewPreconditions, resolveKnowledgeWriteContext, type KnowledgeWriteContext } from "./write-context.js";

export interface PruneCandidate {
  id: string;
  kind: string;
  topic: string | null;
  status: string;
  eligible: boolean;
  reasons: string[];
}

export interface PruneReport {
  schema: "llmdoc.prune/v1";
  repositoryId: string;
  sourceRevision: string | null;
  knowledgeRevision: string | null;
  candidates: PruneCandidate[];
  issues: Array<{ severity: string; code: string; path: string; message: string }>;
}

export interface PruneResult {
  schema: "llmdoc.prune/v1";
  status: "reported" | "prepared";
  repositoryId: string;
  sourceRevision: string | null;
  knowledgeRevision: string | null;
  candidates: PruneCandidate[];
  removed: string[];
  repairedDocuments: string[];
  reviewId: string | null;
  writeSet: ReviewWriteSet | null;
  cleanupRequired: boolean;
}

export interface PruneOptions {
  sourceInput: string;
  knowledgeInput?: string;
  nested?: boolean;
  registryDir?: string;
  remove?: string[];
  report?: boolean;
  global?: boolean;
}

/**
 * Prune is conservative convergence orchestration. It proposes only low-value documents
 * with concrete evidence (exact duplicates or superseded decisions); fragment-only
 * candidates stay `insufficient` and are never removed. Requested removals rewrite every
 * inbound relation and body link so the later seal has no dangling reference, and then
 * form an unconfirmed Review Manifest. Publication remains `commit --review`.
 */
export async function runPruneWorkflow(options: PruneOptions): Promise<PruneResult> {
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
    return pruneLocked(context, options);
  });
}

async function pruneLocked(context: KnowledgeWriteContext, options: PruneOptions): Promise<PruneResult> {
  const report = buildPruneReport(context);
  const requested = [...new Set(options.remove ?? [])];
  if (requested.length === 0) {
    return {
      schema: "llmdoc.prune/v1",
      status: "reported",
      repositoryId: context.entry.repositoryId,
      sourceRevision: context.source.headRevision,
      knowledgeRevision: context.knowledgeHead,
      candidates: report.candidates,
      removed: [],
      repairedDocuments: [],
      reviewId: null,
      writeSet: null,
      cleanupRequired: false
    };
  }

  const byId = new Map(report.candidates.map((candidate) => [candidate.id, candidate]));
  for (const id of requested) {
    const candidate = byId.get(id);
    if (candidate === undefined) {
      throw new KnowledgeError("E_PRUNE_INSUFFICIENT", `Prune has no evidence for ${id}; refusing to remove it`, {
        exitCode: 2,
        paths: [id],
        remediation: "Run `llmdoc prune` and remove only candidates marked eligible."
      });
    }
    if (!candidate.eligible) {
      throw new KnowledgeError("E_PRUNE_INSUFFICIENT", `Prune candidate ${id} is insufficient; conservatively retained`, {
        exitCode: 2,
        paths: [id],
        remediation: "Gather stronger evidence before removing this document."
      });
    }
  }

  // Never remove an entire equivalence group: at least one copy must survive.
  const requestedSet = new Set(requested);
  for (const group of findDuplicateGroups(context.worktreeModel.documents)) {
    if (group.every((id) => requestedSet.has(id))) {
      throw new KnowledgeError(
        "E_PRUNE_INSUFFICIENT",
        `Refusing to remove every member of an exact-duplicate group: ${group.join(", ")}`,
        {
          exitCode: 2,
          paths: group,
          remediation: "Keep at least one canonical copy; remove only the other duplicates."
        }
      );
    }
  }

  await assertReviewPreconditions(context);
  const { repaired, rollback } = await applyPruneRemoval(context, requested);
  try {
    const fresh = await resolveKnowledgeWriteContext({
      sourceInput: options.sourceInput,
      knowledgeInput: options.knowledgeInput,
      nested: options.nested,
      registryDir: options.registryDir
    });
    await assertReviewPreconditions(fresh);
    const manifest = buildReviewManifest(fresh, { global: options.global === true });
    writeReviewManifest(fresh.knowledge.worktreeRoot, manifest);

    return {
      schema: "llmdoc.prune/v1",
      status: "prepared",
      repositoryId: fresh.entry.repositoryId,
      sourceRevision: fresh.source.headRevision,
      knowledgeRevision: fresh.knowledgeHead,
      candidates: buildPruneReport(fresh).candidates,
      removed: requested.sort(),
      repairedDocuments: repaired.sort(),
      reviewId: manifest.reviewId,
      writeSet: manifest.writeSet,
      cleanupRequired: false
    };
  } catch (error) {
    rollback();
    throw error;
  }
}

export function buildPruneReport(context: KnowledgeWriteContext): PruneReport {
  // Eligibility must reflect the content that would actually be deleted: the live
  // worktree, never the committed K0 snapshot. A document that only became a duplicate
  // or was superseded in K0 but has an uncommitted rewrite must not be proposed.
  const model = context.worktreeModel;
  const duplicateGroups = findDuplicateGroups(model.documents);
  const duplicateMembers = new Set(duplicateGroups.flat());
  const survivors = new Set(duplicateGroups.map((group) => group[0]!));
  const candidates: PruneCandidate[] = [];
  for (const document of model.documents) {
    const reasons: string[] = [];
    let eligible = false;
    const isSurvivor = survivors.has(document.id);
    if (duplicateMembers.has(document.id) && !isSurvivor) {
      reasons.push("Exact duplicate of another document (identical normalized body, source paths and relations)");
      eligible = true;
    }
    if (isSurvivor) {
      // Keep exactly one stable copy of each equivalence group.
      reasons.push("Canonical survivor of an exact-duplicate group; retained to keep at least one copy");
    }
    const supersededBy = model.supersededBy.get(document.id) ?? [];
    if (supersededBy.length > 0) {
      reasons.push(`Superseded by ${supersededBy.join(", ")}`);
      if (!isSurvivor) {
        eligible = true;
      }
    }
    const fragments = fragmentsInTopic(model.documents, document);
    if (fragments >= 2 && !eligible && !isSurvivor) {
      reasons.push(`Small fragment (${estimateTokens(document.body)} tokens) in a topic with ${fragments} small documents`);
    }
    if (reasons.length === 0) {
      continue;
    }
    candidates.push({
      id: document.id,
      kind: document.frontmatter.kind,
      topic: document.topic,
      status: context.validity.byId.get(document.id)?.status ?? "unverified",
      eligible,
      reasons
    });
  }
  candidates.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema: "llmdoc.prune/v1",
    repositoryId: context.entry.repositoryId,
    sourceRevision: context.source.headRevision,
    knowledgeRevision: context.knowledgeHead,
    candidates,
    issues: context.issues.filter((issue) => issue.severity === "error").map((issue) => ({ ...issue }))
  };
}

/**
 * Groups byte-semantically identical documents. The key covers the normalized body plus
 * source paths and every canonical relation, so two documents that merely share a
 * description (but differ in body, evidence or relations) are never treated as duplicates.
 */
function findDuplicateGroups(documents: KnowledgeDocument[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const document of documents) {
    const key = exactDuplicateKey(document);
    const bucket = groups.get(key) ?? [];
    bucket.push(document.id);
    groups.set(key, bucket);
  }
  return [...groups.values()]
    .filter((bucket) => bucket.length > 1)
    .map((bucket) => bucket.sort((left, right) => left.localeCompare(right)));
}

function exactDuplicateKey(document: KnowledgeDocument): string {
  const relations = document.frontmatter.relations ?? {};
  return JSON.stringify({
    topic: document.topic ?? "",
    kind: document.frontmatter.kind,
    description: document.frontmatter.description.trim(),
    sourcePaths: [...document.frontmatter.source.paths].sort(),
    requires: [...(relations.requires ?? [])].sort(),
    related: [...(relations.related ?? [])].sort(),
    supersedes: [...(relations.supersedes ?? [])].sort(),
    body: normalizeKnowledgeContent(document.body)
  });
}

function fragmentsInTopic(documents: KnowledgeDocument[], document: KnowledgeDocument): number {
  if (document.topic === null) {
    return 0;
  }
  return documents.filter(
    (candidate) => candidate.topic === document.topic && estimateTokens(candidate.body) <= FRAGMENT_TOKEN_THRESHOLD
  ).length;
}

async function applyPruneRemoval(
  context: KnowledgeWriteContext,
  ids: string[]
): Promise<{ repaired: string[]; rollback: () => void }> {
  const removed = new Set(ids);
  const committed =
    context.knowledgeHead === null
      ? new Map<string, string>()
      : await readGitBlobs(context.knowledgeGit, context.knowledgeHead, ids.map((id) => `docs/${id}`));
  const backups: Array<{ path: string; raw: Buffer }> = [];
  const rollback = (): void => {
    for (const backup of backups) {
      try {
        fs.mkdirSync(path.dirname(backup.path), { recursive: true });
        fs.writeFileSync(backup.path, backup.raw);
      } catch {
        // best-effort restore
      }
    }
  };

  try {
    for (const id of ids) {
      const filePath = path.join(context.knowledge.docsRoot, id);
      if (!fs.existsSync(filePath)) {
        throw new KnowledgeError("E_KNOWLEDGE_DOC_NOT_FOUND", `Cannot remove a missing document: ${id}`, { paths: [id] });
      }
      // Never delete a human draft: the bytes on disk must still equal the committed K0 blob.
      const committedRaw = committed.get(`docs/${id}`);
      const worktreeRaw = fs.readFileSync(filePath);
      if (committedRaw === undefined || !worktreeRaw.equals(Buffer.from(committedRaw, "utf8"))) {
        throw new KnowledgeError(
          "E_PRUNE_INSUFFICIENT",
          `Prune target ${id} has uncommitted changes; refusing to delete a human draft`,
          {
            exitCode: 2,
            paths: [id],
            remediation: "Review, commit or revert the document first; prune only deletes documents byte-identical to the committed snapshot."
          }
        );
      }
      backups.push({ path: filePath, raw: worktreeRaw });
      fs.rmSync(filePath, { force: true });
    }
    const repaired: string[] = [];
    for (const document of context.worktreeModel.documents) {
      if (removed.has(document.id)) {
        continue;
      }
      const rewritten = rewriteInboundReferences(document, removed);
      if (rewritten === null) {
        continue;
      }
      const filePath = path.join(context.knowledge.docsRoot, document.id);
      backups.push({ path: filePath, raw: fs.readFileSync(filePath) });
      fs.writeFileSync(filePath, rewritten);
      repaired.push(document.id);
    }
    return { repaired, rollback };
  } catch (error) {
    rollback();
    throw error;
  }
}

/** Drops front-matter relations and body links pointing at removed documents. */
export function rewriteInboundReferences(document: KnowledgeDocument, removed: Set<string>): string | null {
  let changed = false;
  const parsed = matter(document.raw);
  const data = parsed.data as { relations?: Record<string, string[]> };
  if (data.relations && typeof data.relations === "object") {
    for (const key of ["requires", "related", "supersedes"] as const) {
      const targets = data.relations[key];
      if (!Array.isArray(targets)) {
        continue;
      }
      const filtered = targets.filter((target) => {
        const canonical = normalizeDocTarget(target);
        return canonical === null || !removed.has(canonical);
      });
      if (filtered.length !== targets.length) {
        changed = true;
        if (filtered.length === 0) {
          delete data.relations[key];
        } else {
          data.relations[key] = filtered;
        }
      }
    }
    if (Object.keys(data.relations).length === 0) {
      delete data.relations;
    }
  }

  const body = parsed.content.replace(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g, (whole, label: string, target: string) => {
    const anchorless = target.split("#")[0]?.split("?")[0] ?? target;
    if (anchorless.length === 0) {
      return whole;
    }
    const resolved = normalizeDocTarget(resolveDocLink(document.id, anchorless));
    if (resolved !== null && removed.has(resolved)) {
      changed = true;
      return label;
    }
    return whole;
  });

  if (!changed) {
    return null;
  }
  const rendered = matter.stringify(body, parsed.data);
  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}
