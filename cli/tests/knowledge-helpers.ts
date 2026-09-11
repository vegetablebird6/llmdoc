import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { expect } from "vitest";

import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import { realPath } from "../src/lib/knowledge/paths.js";
import { initKnowledgeRepository } from "../src/lib/knowledge/init.js";
import { contentDigest } from "../src/lib/knowledge/document.js";

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

export async function commitKnowledge(knowledgeRoot: string, message: string): Promise<string> {
  git(knowledgeRoot, ["add", "-A"]);
  const result = spawnSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test User", "-c", "commit.gpgsign=false", "commit", "-m", message],
    { cwd: knowledgeRoot, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }
  );
  if (result.status !== 0) {
    throw new Error(`git commit failed in ${knowledgeRoot}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return head(knowledgeRoot);
}

export function advanceSource(source: string, files: Record<string, string>, message: string): string {
  for (const [rel, content] of Object.entries(files)) {
    writeFile(source, rel, content);
  }
  git(source, ["add", "--", ...Object.keys(files)]);
  const result = spawnSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test User", "-c", "commit.gpgsign=false", "commit", "-m", message],
    { cwd: source, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }
  );
  if (result.status !== 0) {
    throw new Error(`git commit failed in ${source}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return head(source);
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

export interface FixtureDoc {
  id: string;
  content: string;
  scope: string[];
  requires?: string[];
}

export interface KnowledgeFixture {
  base: string;
  registryDir: string;
  source: string;
  sourceHead: string;
  knowledgeRoot: string;
  repositoryId: string;
  knowledgeHead: string;
}

/** Builds a real external source/knowledge pair with a committed K0 ledger. */
export async function createKnowledgeFixture(
  prefix: string,
  sourceFiles: Record<string, string>,
  docs: FixtureDoc[],
  options: { registryDir?: string } = {}
): Promise<KnowledgeFixture> {
  const base = makeTempDir(prefix);
  const source = initRepo(path.join(base, "source"));
  for (const [rel, content] of Object.entries(sourceFiles)) {
    writeFile(source, rel, content);
  }
  git(source, ["add", "--", ...Object.keys(sourceFiles)]);
  const sourceCommit = spawnSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test User", "-c", "commit.gpgsign=false", "commit", "-m", "source"],
    { cwd: source, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }
  );
  if (sourceCommit.status !== 0) {
    throw new Error(`source commit failed: ${(sourceCommit.stderr || sourceCommit.stdout || "").trim()}`);
  }
  const sourceHead = head(source);
  const registryDir = options.registryDir ?? path.join(base, "registry");
  const init = await initKnowledgeRepository({
    sourceInput: source,
    knowledgeInput: path.join(base, "knowledge"),
    registryDir
  });
  const knowledgeRoot = init.knowledgeRoot;
  const digests = new Map(docs.map((doc) => [doc.id, contentDigest(doc.content)]));
  for (const doc of docs) {
    writeFile(knowledgeRoot, `docs/${doc.id}`, doc.content);
  }
  const documents: Record<string, unknown> = {};
  for (const doc of docs) {
    const requires: Record<string, string> = {};
    for (const target of doc.requires ?? []) {
      const digest = digests.get(target);
      if (digest !== undefined) {
        requires[target] = digest;
      }
    }
    documents[doc.id] = {
      validatedSourceRevision: sourceHead,
      validatedContentDigest: digests.get(doc.id),
      validatedSourcePaths: [...doc.scope].sort(),
      validatedRequires: requires
    };
  }
  fs.mkdirSync(path.join(knowledgeRoot, ".llmdoc"), { recursive: true });
  fs.writeFileSync(path.join(knowledgeRoot, ".llmdoc", "meta.json"), knowledgeMetaJson(init.repositoryId, null, documents));
  const knowledgeHead = await commitKnowledge(knowledgeRoot, "K0");
  return { base, registryDir, source, sourceHead, knowledgeRoot, repositoryId: init.repositoryId, knowledgeHead };
}

export { realPath };
