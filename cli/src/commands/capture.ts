import { captureCandidate, type CaptureResult } from "../lib/knowledge/capture.js";

export interface CaptureCommandOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
  title?: string;
  note?: string;
  from?: string;
  body?: string;
  sourceRevision?: string;
}

export interface CaptureCommandResult {
  output: unknown;
  exitCode: number;
}

export async function runCapture(options: CaptureCommandOptions): Promise<CaptureCommandResult> {
  const result: CaptureResult = await captureCandidate({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir,
    title: options.title,
    note: options.note,
    fromFile: options.from,
    body: options.body,
    sourceRevision: options.sourceRevision
  });
  return { output: result, exitCode: result.cleanupRequired ? 70 : 0 };
}
