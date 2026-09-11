import { buildReviewItems } from "../lib/knowledge/review.js";
import { resolveKnowledgeWriteContext, type KnowledgeWriteContext } from "../lib/knowledge/write-context.js";

export interface DeltaOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
  scope?: string[];
}

export interface DeltaImpact {
  id: string;
  action: string;
  contentChanged: boolean;
  scopeRemoved: string[];
  requiresChanged: boolean;
  reasons: string[];
}

export interface DeltaPayload {
  schema: "llmdoc.delta/v1";
  repositoryId: string;
  sourceRevision: string | null;
  knowledgeRevision: string | null;
  knowledgeBranch: string | null;
  sourceBlockers: KnowledgeWriteContext["validity"]["sourceBlockers"];
  historyAvailable: boolean;
  lastGlobalReviewRevision: string | null;
  suggestedMode: "light" | "deep";
  reasons: string[];
  impacted: DeltaImpact[];
}

export async function runDelta(options: DeltaOptions): Promise<unknown> {
  const context = await resolveKnowledgeWriteContext({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir
  });
  const payload = buildDeltaPayload(context, options.scope);
  if (options.json) {
    return payload;
  }
  return renderDelta(payload);
}

export function buildDeltaPayload(context: KnowledgeWriteContext, scope?: string[]): DeltaPayload {
  const scopeFilter = scope !== undefined && scope.length > 0 ? new Set(scope) : null;
  const items = buildReviewItems(context, {});
  const impacted: DeltaImpact[] = [];
  const reasons: string[] = [];
  for (const item of items) {
    if (scopeFilter !== null && !scopeFilter.has(item.id)) {
      continue;
    }
    const requiresChanged =
      item.candidateRequires.length > 0 &&
      JSON.stringify(item.candidateRequires) !==
        JSON.stringify(Object.entries(item.oldValidatedRequires).map(([id, digest]) => ({ id, digest })).sort(byId));
    const contentChanged = item.action === "add" || item.action === "delete" || item.oldDigest !== item.candidateDigest;
    impacted.push({
      id: item.id,
      action: item.action,
      contentChanged,
      scopeRemoved: [...item.removedScope],
      requiresChanged,
      reasons: [...item.reasons]
    });
    for (const reason of item.reasons) {
      if (!reasons.includes(reason)) {
        reasons.push(reason);
      }
    }
  }
  impacted.sort((left, right) => left.id.localeCompare(right.id));
  const deep = impacted.some((impact) => impact.contentChanged || impact.requiresChanged);
  return {
    schema: "llmdoc.delta/v1",
    repositoryId: context.entry.repositoryId,
    sourceRevision: context.source.headRevision,
    knowledgeRevision: context.knowledgeHead,
    knowledgeBranch: context.knowledgeBranch,
    sourceBlockers: context.validity.sourceBlockers.map((blocker) => ({ ...blocker, paths: [...blocker.paths] })),
    historyAvailable: context.validity.historyAvailable,
    lastGlobalReviewRevision: context.validity.lastGlobalReviewRevision,
    suggestedMode: deep ? "deep" : "light",
    reasons,
    impacted
  };
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function renderDelta(payload: DeltaPayload): string {
  const lines = [
    `mode: ${payload.suggestedMode}`,
    `source: ${payload.sourceRevision ?? "invalid"}`,
    `knowledge: ${payload.knowledgeRevision ?? "unborn"}`,
    `impacted: ${payload.impacted.length}`
  ];
  for (const impact of payload.impacted.slice(0, 20)) {
    lines.push(`  ${impact.action}: ${impact.id}${impact.contentChanged ? " (content)" : ""}${impact.requiresChanged ? " (requires)" : ""}`);
  }
  if (payload.reasons.length > 0) {
    lines.push(`reasons: ${payload.reasons.join("; ")}`);
  }
  return lines.join("\n");
}
