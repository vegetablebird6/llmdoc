import { KnowledgeError } from "../lib/knowledge/errors.js";
import {
  buildReviewManifest,
  confirmReviewManifest,
  loadReviewManifest,
  writeReviewManifest,
  type ReviewConclusion,
  type ReviewManifest
} from "../lib/knowledge/review.js";
import { withKnowledgeLock } from "../lib/knowledge/lock.js";
import { assertReviewPreconditions, resolveKnowledgeWriteContext } from "../lib/knowledge/write-context.js";

export interface ReviewOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
  confirm?: string;
  set?: string[];
  global?: boolean;
}

export interface ReviewResult {
  output: unknown;
  exitCode: number;
}

export async function runReview(options: ReviewOptions): Promise<ReviewResult> {
  const context = await resolveKnowledgeWriteContext({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir
  });
  return withKnowledgeLock(context.knowledge.commonDir, async () => {
    await assertReviewPreconditions(context);
    if (options.confirm !== undefined) {
      const manifest = loadReviewManifest(context.knowledge.worktreeRoot, options.confirm);
      const overrides = parseAssignments(options.set ?? []);
      const confirmed = confirmReviewManifest(context, manifest, { overrides });
      writeReviewManifest(context.knowledge.worktreeRoot, confirmed);
      return { output: renderReview("confirmed", confirmed), exitCode: 0 };
    }
    const manifest = buildReviewManifest(context, { global: options.global === true });
    writeReviewManifest(context.knowledge.worktreeRoot, manifest);
    return { output: renderReview("generated", manifest), exitCode: 0 };
  });
}

function renderReview(status: "generated" | "confirmed", manifest: ReviewManifest): Record<string, unknown> {
  return {
    schema: "llmdoc.review/v1",
    status,
    reviewId: manifest.reviewId,
    repositoryId: manifest.repositoryId,
    sourceRevision: manifest.sourceRevision,
    knowledgeBaseRevision: manifest.knowledgeBaseRevision,
    knowledgeRoot: manifest.knowledgeRoot,
    global: manifest.global,
    confirmed: manifest.confirmed,
    writeSet: manifest.writeSet,
    documents: manifest.documents.map((item) => ({
      id: item.id,
      action: item.action,
      proposedConclusion: item.proposedConclusion,
      conclusion: item.conclusion,
      oldDigest: item.oldDigest,
      candidateDigest: item.candidateDigest,
      oldScope: item.oldScope,
      newScope: item.newScope,
      removedScope: item.removedScope,
      oldSourceRevision: item.oldSourceRevision,
      oldValidatedRequires: item.oldValidatedRequires,
      candidateRequires: item.candidateRequires,
      reasons: item.reasons
    }))
  };
}

function parseAssignments(assignments: string[]): Record<string, ReviewConclusion> {
  const overrides: Record<string, ReviewConclusion> = {};
  for (const assignment of assignments) {
    const separator = assignment.lastIndexOf("=");
    if (separator <= 0) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Invalid --set assignment (expected id=changed|unchanged|insufficient): ${assignment}`, {
        paths: [assignment]
      });
    }
    const id = assignment.slice(0, separator);
    const conclusion = assignment.slice(separator + 1);
    if (conclusion !== "changed" && conclusion !== "unchanged" && conclusion !== "insufficient") {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Invalid conclusion for ${id}: ${conclusion}`, { paths: [id] });
    }
    overrides[id] = conclusion;
  }
  return overrides;
}
