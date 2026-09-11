import { KnowledgeError } from "../lib/knowledge/errors.js";
import { sealKnowledgeReview, type SealResult } from "../lib/knowledge/seal.js";

export interface CommitOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
  review?: string;
}

export interface CommitResult {
  output: unknown;
  exitCode: number;
}

export async function runCommit(options: CommitOptions): Promise<CommitResult> {
  if (options.review === undefined || options.review.trim().length === 0) {
    throw new KnowledgeError("E_REVIEW_NOT_FOUND", "commit requires a confirmed review manifest: pass --review <reviewId>", {
      remediation: "Run `llmdoc review` to generate a manifest, confirm the semantic conclusions, then `llmdoc commit --review <reviewId>`."
    });
  }
  const result: SealResult = await sealKnowledgeReview({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir,
    reviewId: options.review
  });
  return {
    output: result,
    exitCode: result.cleanupRequired ? 70 : 0
  };
}
