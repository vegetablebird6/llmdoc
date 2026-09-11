import { matchesCodePathPattern } from "../search.js";
import { changedPathsBetween, isAncestor, listTreeFiles, runGit, type GitRepoLayout } from "./git-core.js";
import { relationsFor, type KnowledgeIssue, type KnowledgeModel } from "./knowledge-model.js";
import type { KnowledgeMeta } from "./meta.js";
import type { SourceBlocker, SourceContext } from "./contexts.js";

export type DocumentStatus = "unverified" | "current" | "needs_review";

export interface DocumentValidity {
  id: string;
  status: DocumentStatus;
  reasons: string[];
}

export interface ValidityProjection {
  byId: Map<string, DocumentValidity>;
  sourceRevision: string | null;
  lastGlobalReviewRevision: string | null;
  sourceBlockers: SourceBlocker[];
  historyAvailable: boolean;
  /** Deterministic structural issues discovered while projecting validity (e.g. source scope evidence). */
  issues: KnowledgeIssue[];
}

export interface ComputeValidityInput {
  model: KnowledgeModel;
  meta: KnowledgeMeta | null;
  source: SourceContext | null;
  /** True only when a precise source/knowledge identity association is proven. */
  identityVerified: boolean;
  /** The fixed knowledge revision whose docs/meta were read; null for unbound filesystem reads. */
  knowledgeRevision: string | null;
}

export async function computeValidity(input: ComputeValidityInput): Promise<ValidityProjection> {
  const { model, meta, source, identityVerified, knowledgeRevision } = input;
  const byId = new Map<string, DocumentValidity>();
  const sourceLayout: GitRepoLayout | null = source
    ? { worktreeRoot: source.worktreeRoot, gitDir: source.gitDir, commonDir: source.commonDir }
    : null;
  const commitCache = new Map<string, boolean>();
  const ancestorCache = new Map<string, boolean>();
  const changedCache = new Map<string, string[]>();
  const commitExists = async (revision: string): Promise<boolean> => {
    if (!sourceLayout) {
      return false;
    }
    const cached = commitCache.get(revision);
    if (cached !== undefined) {
      return cached;
    }
    const result = await runGit(sourceLayout, ["cat-file", "-e", `${revision}^{commit}`], { allowMissing: true });
    const exists = result !== null;
    commitCache.set(revision, exists);
    return exists;
  };

  const sourceBlockers: SourceBlocker[] = source ? source.blockers.map((blocker) => ({ ...blocker, paths: [...blocker.paths] })) : [];
  const sourceUsable = source !== null && source.headRevision !== null;
  const missingRevisions = new Set<string>();
  const divergedRevisions = new Set<string>();
  const validityIssues: KnowledgeIssue[] = [];
  const sourcePathProblems = new Map<string, string[]>();

  if (sourceUsable && sourceLayout && source) {
    await collectSourceScopeEvidence(sourceLayout, source.headRevision!, model, sourcePathProblems, validityIssues);

    // Source history health is a SourceContext fact. Compute it independently from
    // document digest/identity checks so an earlier document reason cannot hide a
    // missing or diverged validation revision from the shared projection.
    const validatedRevisions = [
      ...new Set(
        Object.values(meta?.documents ?? {})
          .map((evidence) => evidence.validatedSourceRevision)
          .filter((revision): revision is string => revision !== null)
      )
    ].sort();
    for (const revision of validatedRevisions) {
      if (!(await commitExists(revision))) {
        missingRevisions.add(revision);
      } else if (!(await isAncestorCached(sourceLayout, revision, source.headRevision!, ancestorCache))) {
        divergedRevisions.add(revision);
      }
    }
  }

  for (const id of topologicalOrder(model)) {
    const document = model.byId.get(id)!;
    const evidence = meta?.documents[id];
    const reasons: string[] = [];

    if (model.cyclicIds.has(id)) {
      reasons.push("Document participates in a requires cycle");
    } else if (!evidence || evidence.validatedContentDigest === null) {
      byId.set(id, { id, status: "unverified", reasons: ["No validation evidence recorded"] });
      continue;
    } else {
      if (evidence.validatedContentDigest !== document.contentDigest) {
        reasons.push("Document content changed since validation (digest mismatch)");
      } else if (knowledgeRevision === null) {
        reasons.push("Knowledge snapshot is not a committed revision; validity cannot be claimed");
      } else if (!identityVerified) {
        reasons.push("No provable source/knowledge identity association; validity cannot be claimed");
      } else if (evidence.validatedSourceRevision === null) {
        reasons.push("No validated source revision recorded");
      } else if (source === null) {
        reasons.push("Source context is unavailable; validity cannot be claimed");
      } else if (!sourceUsable) {
        reasons.push("Source HEAD is not a valid committed snapshot");
      } else if (missingRevisions.has(evidence.validatedSourceRevision)) {
        reasons.push(`Validated source revision is not available in history: ${evidence.validatedSourceRevision}`);
      } else if (divergedRevisions.has(evidence.validatedSourceRevision)) {
        reasons.push(`Validated source revision is not an ancestor of HEAD (diverged or history unavailable): ${evidence.validatedSourceRevision}`);
      } else {
        const currentScope = normalizeList(document.frontmatter.source.paths);
        const recordedScope = normalizeList(evidence.validatedSourcePaths);
        if (!sameList(currentScope, recordedScope)) {
          reasons.push("Source scope changed since validation");
        }
        const scopeUnion = normalizeList([...recordedScope, ...currentScope]);
        const changed = await changedPathsBetweenCached(sourceLayout!, evidence.validatedSourceRevision, source.headRevision!, changedCache);
        const relatedChanges = changed.filter((changedPath) =>
          scopeUnion.some((pattern) => matchesCodePathPattern(pattern, changedPath))
        );
        if (relatedChanges.length > 0) {
          reasons.push(`Related committed source changed since validation: ${relatedChanges.slice(0, 5).join(", ")}`);
        }
        const currentRequires = normalizeList(relationsFor(model, id).requires);
        const recordedRequires = Object.keys(evidence.validatedRequires).sort();
        if (!sameList(currentRequires, recordedRequires)) {
          reasons.push("requires set changed since validation");
        }
        for (const target of currentRequires) {
          const targetDocument = model.byId.get(target);
          const targetValidity = byId.get(target);
          if (!targetDocument || !targetValidity) {
            reasons.push(`requires target is missing: ${target}`);
            continue;
          }
          if (targetValidity.status !== "current") {
            reasons.push(`requires target is not current: ${target}`);
            continue;
          }
          if (evidence.validatedRequires[target] !== targetDocument.contentDigest) {
            reasons.push(`requires target digest changed: ${target}`);
          }
        }
      }
      if (model.requiresProblems.has(id)) {
        reasons.push("relations.requires is structurally invalid (missing target, self-reference or non-canonical path)");
      }
      const problems = sourcePathProblems.get(id);
      if (problems) {
        reasons.push(...problems);
      }
      if (model.issues.some((issue) => issue.path === id && issue.code === "source.paths.invalid")) {
        reasons.push("source.paths contains an invalid or non-canonical path");
      }
    }

    byId.set(id, {
      id,
      status: reasons.length === 0 ? "current" : "needs_review",
      reasons
    });
  }

  if (missingRevisions.size > 0) {
    sourceBlockers.push({
      code: "history_unavailable",
      message: "Some validated source revisions are not available in the source history.",
      paths: [...missingRevisions].sort()
    });
  }
  if (divergedRevisions.size > 0) {
    sourceBlockers.push({
      code: "diverged",
      message: "Some validated source revisions are not ancestors of the current HEAD (diverged or rewritten history).",
      paths: [...divergedRevisions].sort()
    });
  }
  const historyAvailable =
    source !== null && source.headRevision !== null && missingRevisions.size === 0 && divergedRevisions.size === 0;

  return {
    byId,
    sourceRevision: source?.headRevision ?? null,
    lastGlobalReviewRevision: meta?.source.lastGlobalReviewRevision ?? null,
    sourceBlockers,
    historyAvailable,
    issues: validityIssues
  };
}

function isGlobPattern(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

/**
 * Validates every current source.paths pattern against the fixed committed Source HEAD tree.
 * Reading the tree (not the live worktree) means an uncommitted file can never satisfy a scope,
 * and a literal that is absent or a glob with zero committed matches cannot authorize `current`.
 */
async function collectSourceScopeEvidence(
  sourceLayout: GitRepoLayout,
  headRevision: string,
  model: KnowledgeModel,
  problemsByDocument: Map<string, string[]>,
  issues: KnowledgeIssue[]
): Promise<void> {
  const treeFiles = await listTreeFiles(sourceLayout, headRevision, ".");
  const treeSet = new Set(treeFiles);
  for (const document of model.documents) {
    const problems: string[] = [];
    for (const pattern of document.frontmatter.source.paths) {
      if (isGlobPattern(pattern)) {
        if (!treeFiles.some((file) => matchesCodePathPattern(pattern, file))) {
          problems.push(`source.paths glob has no committed match at the fixed source revision: ${pattern}`);
          issues.push({
            severity: "error",
            code: "source.paths.glob-empty",
            path: document.id,
            message: `source.paths glob matches no committed source file at ${headRevision}: ${pattern}`
          });
        }
        continue;
      }
      if (!treeSet.has(pattern) && !treeFiles.some((file) => file.startsWith(`${pattern}/`))) {
        problems.push(`source.paths literal does not exist at the fixed source revision: ${pattern}`);
        issues.push({
          severity: "error",
          code: "source.paths.missing",
          path: document.id,
          message: `source.paths literal does not exist at ${headRevision}: ${pattern}`
        });
      }
    }
    if (problems.length > 0) {
      problemsByDocument.set(document.id, problems);
    }
  }
}

export function statusOf(projection: ValidityProjection, id: string): DocumentStatus {
  return projection.byId.get(id)?.status ?? "unverified";
}

async function isAncestorCached(
  layout: GitRepoLayout,
  ancestor: string,
  descendant: string,
  cache: Map<string, boolean>
): Promise<boolean> {
  const cached = cache.get(ancestor);
  if (cached !== undefined) {
    return cached;
  }
  const result = await isAncestor(layout, ancestor, descendant);
  cache.set(ancestor, result);
  return result;
}

async function changedPathsBetweenCached(
  layout: GitRepoLayout,
  from: string,
  to: string,
  cache: Map<string, string[]>
): Promise<string[]> {
  const cached = cache.get(from);
  if (cached) {
    return cached;
  }
  const result = await changedPathsBetween(layout, from, to);
  cache.set(from, result);
  return result;
}

function topologicalOrder(model: KnowledgeModel): string[] {
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    const current = state.get(id) ?? 0;
    if (current !== 0) {
      return;
    }
    state.set(id, 1);
    for (const dependency of relationsFor(model, id).requires) {
      visit(dependency);
    }
    state.set(id, 2);
    order.push(id);
  };
  for (const id of [...model.byId.keys()].sort()) {
    visit(id);
  }
  return order;
}

function normalizeList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
