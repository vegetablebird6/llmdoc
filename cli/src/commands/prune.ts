import { runPruneWorkflow, type PruneResult } from "../lib/knowledge/prune.js";

export interface PruneCommandOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
  report?: boolean;
  remove?: string[];
  global?: boolean;
}

export interface PruneCommandResult {
  output: unknown;
  exitCode: number;
}

export async function runPrune(options: PruneCommandOptions): Promise<PruneCommandResult> {
  const result: PruneResult = await runPruneWorkflow({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir,
    remove: options.remove,
    report: options.report,
    global: options.global
  });
  return { output: result, exitCode: 0 };
}
