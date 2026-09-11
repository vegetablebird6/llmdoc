import { computeValidity } from "../lib/knowledge/validity.js";
import { resolveKnowledgeWriteContext } from "../lib/knowledge/write-context.js";
import type { KnowledgeIssue } from "../lib/knowledge/knowledge-model.js";

export interface ValidateOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  output: unknown;
  exitCode: number;
}

export async function runValidate(options: ValidateOptions): Promise<ValidateResult> {
  const context = await resolveKnowledgeWriteContext({
    sourceInput: options.source ?? options.cwd,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir
  });
  const validity = await computeValidity({
    model: context.worktreeModel,
    meta: context.worktree.meta,
    source: context.source,
    identityVerified: true,
    knowledgeRevision: context.knowledgeHead
  });
  const issues = dedupeIssues([...context.worktree.issues, ...context.worktreeModel.issues, ...validity.issues]);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const ok = errors.length === 0;
  const payload = { ok, errors, warnings };

  if (options.json) {
    return { ok, output: { schema: "llmdoc.validate/v1", ...payload }, exitCode: ok ? 0 : 2 };
  }

  const rendered = ok
    ? "validate: ok"
    : [
        errors.length > 0 ? "errors:" : "",
        errors.length > 0 ? formatIssues(errors) : "",
        warnings.length > 0 ? "warnings:" : "",
        warnings.length > 0 ? formatIssues(warnings) : ""
      ]
        .filter(Boolean)
        .join("\n");
  return { ok, output: rendered, exitCode: ok ? 0 : 2 };
}

function dedupeIssues(issues: KnowledgeIssue[]): KnowledgeIssue[] {
  const seen = new Set<string>();
  const result: KnowledgeIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.severity}\u0000${issue.code}\u0000${issue.path}\u0000${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ severity: issue.severity, code: issue.code, path: issue.path, message: issue.message });
  }
  return result;
}

function formatIssues(issues: KnowledgeIssue[]): string {
  return issues.map((issue) => `  ${issue.code} (${issue.path}): ${issue.message}`).join("\n");
}
