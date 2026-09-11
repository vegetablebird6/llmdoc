import { KnowledgeError } from "../lib/knowledge/errors.js";
import { runUpdateWorkflow, type PromoteRequest, type UpdateResult } from "../lib/knowledge/update.js";

export interface UpdateCommandOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
  promote?: string;
  to?: string;
  kind?: string;
  description?: string;
  sourcePath?: string[];
  requires?: string[];
  related?: string[];
  supersedes?: string[];
  reject?: string[];
  prepare?: boolean;
  global?: boolean;
}

export interface UpdateCommandResult {
  output: unknown;
  exitCode: number;
}

export async function runUpdate(options: UpdateCommandOptions): Promise<UpdateCommandResult> {
  let promote: PromoteRequest | undefined;
  if (options.promote !== undefined) {
    if (
      options.to === undefined ||
      options.kind === undefined ||
      options.description === undefined ||
      options.sourcePath === undefined ||
      options.sourcePath.length === 0
    ) {
      throw new KnowledgeError(
        "E_DOCUMENT_INVALID",
        "--promote requires --to <docId> --kind <kind> --description <text> --source-path <path...>",
        {
          exitCode: 2,
          paths: [options.promote],
          remediation: "Provide the canonical document identity and its required source evidence scope."
        }
      );
    }
    promote = {
      candidate: options.promote,
      to: options.to,
      kind: options.kind,
      description: options.description,
      sourcePaths: options.sourcePath,
      requires: options.requires,
      related: options.related,
      supersedes: options.supersedes
    };
  }

  const result: UpdateResult = await runUpdateWorkflow({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir,
    promote,
    reject: options.reject,
    prepare: options.prepare,
    global: options.global
  });
  return { output: result, exitCode: 0 };
}
