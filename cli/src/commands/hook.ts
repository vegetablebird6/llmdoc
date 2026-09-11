import { isKnowledgeHookEvent, runKnowledgeHook, type KnowledgeHookEvent, type KnowledgeHookResult } from "../lib/knowledge/hook.js";
import { KnowledgeError } from "../lib/knowledge/errors.js";

export interface HookCommandOptions {
  cwd: string;
  event: string;
  source?: string;
  knowledge?: string;
  registryDir?: string;
  json?: boolean;
}

export interface HookCommandResult {
  event: KnowledgeHookEvent;
  result: KnowledgeHookResult;
  exitCode: number;
}

export async function runHook(options: HookCommandOptions): Promise<HookCommandResult> {
  if (!isKnowledgeHookEvent(options.event)) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Unknown hook event: ${options.event}`, {
      paths: [options.event],
      remediation: "Use one of: session-start, stop, compact."
    });
  }
  const result = await runKnowledgeHook({
    cwd: options.cwd,
    event: options.event,
    source: options.source,
    knowledge: options.knowledge,
    registryDir: options.registryDir
  });
  return { event: options.event, result, exitCode: 0 };
}
