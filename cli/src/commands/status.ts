import { buildReviewItems } from "../lib/knowledge/review.js";
import { resolveKnowledgeWriteContext, type KnowledgeWriteContext } from "../lib/knowledge/write-context.js";
import type { DocumentStatus } from "../lib/knowledge/validity.js";

export interface StatusOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
}

export interface StatusPayload {
  schema: "llmdoc.status/v1";
  repositoryId: string;
  knowledgeRoot: string;
  sourceRevision: string | null;
  knowledgeRevision: string | null;
  knowledgeBranch: string | null;
  sourceBlockers: ReturnType<typeof copyBlockers>;
  historyAvailable: boolean;
  lastGlobalReviewRevision: string | null;
  index: { clean: boolean; stagedPaths: string[] };
  drafts: string[];
  documents: { total: number; current: number; needsReview: number; unverified: number };
  reviewObligations: Array<{ id: string; status: DocumentStatus; reasons: string[] }>;
  issues: KnowledgeWriteContext["issues"];
}

export async function runStatus(options: StatusOptions): Promise<unknown> {
  const context = await resolveKnowledgeWriteContext({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir
  });
  const payload = buildStatusPayload(context);
  if (options.json) {
    return payload;
  }
  return renderStatus(payload);
}

export function buildStatusPayload(context: KnowledgeWriteContext): StatusPayload {
  const counts = { total: 0, current: 0, needsReview: 0, unverified: 0 };
  const reviewObligations: Array<{ id: string; status: DocumentStatus; reasons: string[] }> = [];
  for (const document of context.k0Model.documents) {
    counts.total += 1;
    const validity = context.validity.byId.get(document.id);
    const status: DocumentStatus = validity?.status ?? "unverified";
    if (status === "current") {
      counts.current += 1;
    } else if (status === "needs_review") {
      counts.needsReview += 1;
    } else {
      counts.unverified += 1;
    }
    if (status !== "current") {
      reviewObligations.push({ id: document.id, status, reasons: validity?.reasons ?? [] });
    }
  }
  const drafts = buildReviewItems(context, {}).map((item) => item.id).sort();
  return {
    schema: "llmdoc.status/v1",
    repositoryId: context.entry.repositoryId,
    knowledgeRoot: context.knowledge.worktreeRoot,
    sourceRevision: context.source.headRevision,
    knowledgeRevision: context.knowledgeHead,
    knowledgeBranch: context.knowledgeBranch,
    sourceBlockers: copyBlockers(context),
    historyAvailable: context.validity.historyAvailable,
    lastGlobalReviewRevision: context.validity.lastGlobalReviewRevision,
    index: { clean: context.knowledgeClean.stagedPaths.length === 0, stagedPaths: [...context.knowledgeClean.stagedPaths] },
    drafts,
    documents: counts,
    reviewObligations,
    issues: context.issues.map((issue) => ({ ...issue }))
  };
}

function renderStatus(payload: StatusPayload): string {
  const lines = [
    `repository: ${payload.repositoryId}`,
    `source: ${payload.sourceRevision ?? "invalid"} (${payload.sourceBlockers.length === 0 ? "clean" : "blocked"})`,
    `knowledge: ${payload.knowledgeRevision ?? "unborn"} on ${payload.knowledgeBranch ?? "detached"}`,
    `lastGlobalReviewRevision: ${payload.lastGlobalReviewRevision ?? "null"}`,
    `index: ${payload.index.clean ? "clean" : `staged ${payload.index.stagedPaths.length} path(s)`}`,
    `documents: ${payload.documents.total} total / ${payload.documents.current} current / ${payload.documents.needsReview} needs-review / ${payload.documents.unverified} unverified`,
    `drafts: ${payload.drafts.length}`
  ];
  for (const obligation of payload.reviewObligations.slice(0, 10)) {
    lines.push(`  ${obligation.status}: ${obligation.id}`);
  }
  for (const blocker of payload.sourceBlockers) {
    lines.push(`source-blocker: ${blocker.code} ${blocker.message}`);
  }
  return lines.join("\n");
}

function copyBlockers(context: KnowledgeWriteContext): KnowledgeWriteContext["validity"]["sourceBlockers"] {
  return context.validity.sourceBlockers.map((blocker) => ({ ...blocker, paths: [...blocker.paths] }));
}
