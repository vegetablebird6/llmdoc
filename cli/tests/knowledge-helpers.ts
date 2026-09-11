import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { expect } from "vitest";

import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import { realPath } from "../src/lib/knowledge/paths.js";

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function git(dir: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${dir}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

export function gitAllowFail(dir: string, args: string[]): void {
  spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}

export function initRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  return dir;
}

export function writeFile(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function commitFile(dir: string, rel: string, content: string, message: string): void {
  writeFile(dir, rel, content);
  git(dir, ["add", rel]);
  git(dir, ["commit", "-m", message]);
}

export function head(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

export async function expectKnowledgeError(run: () => unknown | Promise<unknown>, code: string, exitCode = 2): Promise<KnowledgeError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    const knowledgeError = error as KnowledgeError;
    expect(knowledgeError.code).toBe(code);
    expect(knowledgeError.exitCode).toBe(exitCode);
    return knowledgeError;
  }
  throw new Error(`expected KnowledgeError ${code}, but the call succeeded`);
}

export function snapshotWorktree(rootDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.set(path.relative(rootDir, absolute).replaceAll(path.sep, "/"), fs.readFileSync(absolute).toString("hex"));
      }
    }
  };
  visit(rootDir);
  return files;
}

export function sourceIndexBytes(sourceRoot: string): Buffer {
  return fs.readFileSync(path.join(sourceRoot, ".git", "index"));
}

export interface KnowledgeDocOptions {
  paths?: string[];
  requires?: string[];
  supersedes?: string[];
  body?: string;
}

/** Builds a front matter document for the knowledge protocol (source.paths is required). */
export function knowledgeDoc(kind: string, description: string, options: KnowledgeDocOptions = {}): string {
  const lines = ["---", `description: ${description}`, `kind: ${kind}`, "source:", "  paths:"];
  for (const sourcePath of options.paths ?? ["src/api/retry.ts"]) {
    lines.push(`    - ${sourcePath}`);
  }
  if (options.requires || options.supersedes) {
    lines.push("relations:");
    if (options.requires) {
      lines.push("  requires:");
      for (const target of options.requires) lines.push(`    - ${target}`);
    }
    if (options.supersedes) {
      lines.push("  supersedes:");
      for (const target of options.supersedes) lines.push(`    - ${target}`);
    }
  }
  lines.push("---", "", options.body ?? `# ${description}`, "");
  return `${lines.join("\n")}\n`;
}

export function knowledgeMetaJson(
  repositoryId: string,
  lastGlobalReviewRevision: string | null,
  documents: Record<string, unknown>
): string {
  return `${JSON.stringify(
    {
      schema: "llmdoc.meta/v3-ng",
      source: { repositoryId, lastGlobalReviewRevision },
      documents
    },
    null,
    2
  )}\n`;
}

export { realPath };
