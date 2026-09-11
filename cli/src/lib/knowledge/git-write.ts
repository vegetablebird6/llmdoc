import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { KnowledgeError } from "./errors.js";
import { sanitizedGitEnv, type GitRepoLayout } from "./git-core.js";

/**
 * Write-side Git plumbing. Every invocation is bound to an explicit layout, uses an
 * explicit index file when one is supplied, and disables hooks, signing and external
 * helpers so sealing can never be redirected by repository or user configuration.
 */

let hooksDisabledDir: string | null = null;

function emptyHooksDir(): string {
  if (hooksDisabledDir === null) {
    const dir = path.join(os.tmpdir(), `llmdoc-no-hooks-${process.pid}`);
    fs.mkdirSync(dir, { recursive: true });
    hooksDisabledDir = dir;
  }
  return hooksDisabledDir;
}

const WRITE_CONFIG_OVERRIDES = [
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.safecrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "gc.auto=0"
];

export interface GitWriteOptions {
  /** Extra environment entries (e.g. GIT_INDEX_FILE or explicit commit identity). */
  env?: Record<string, string>;
  /** Content written to the child's stdin. */
  input?: string;
  /** When true a non-zero exit resolves to null instead of throwing. */
  allowFail?: boolean;
}

export async function runGitWrite(layout: GitRepoLayout, args: string[], options: GitWriteOptions = {}): Promise<string> {
  const result = await spawnWriteGit(layout.worktreeRoot, [
    "-C",
    layout.worktreeRoot,
    "-c",
    "core.quotePath=false",
    "-c",
    `core.hooksPath=${emptyHooksDir()}`,
    ...WRITE_CONFIG_OVERRIDES,
    ...args
  ], options);
  if (result.error) {
    throw new KnowledgeError("E_GIT_INVOCATION_FAILED", `Failed to execute git: ${result.error.message}`, {
      exitCode: 70,
      paths: [layout.worktreeRoot]
    });
  }
  if (result.status !== 0) {
    if (options.allowFail) {
      return "";
    }
    const detail = (result.stderr || result.stdout || "git command failed").trim();
    throw new KnowledgeError("E_GIT_INVOCATION_FAILED", `git ${args[0] ?? ""} failed: ${detail}`, {
      exitCode: 70,
      paths: [layout.worktreeRoot]
    });
  }
  return result.stdout;
}

interface SpawnWriteResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function spawnWriteGit(cwd: string, args: string[], options: GitWriteOptions): Promise<SpawnWriteResult> {
  return new Promise((resolve) => {
    const environment: NodeJS.ProcessEnv = { ...sanitizedGitEnv(), ...(options.env ?? {}) };
    const child = spawn("git", args, { cwd, env: environment });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ status: null, stdout, stderr, error });
    });
    child.on("close", (code) => {
      resolve({ status: code, stdout, stderr });
    });
    if (options.input !== undefined) {
      child.stdin!.write(options.input);
    }
    child.stdin!.end();
  });
}

/** Writes bytes as a loose object (no filters applied) and returns the full blob OID. */
export async function hashBlob(layout: GitRepoLayout, content: string): Promise<string> {
  const output = await runGitWrite(layout, ["hash-object", "-w", "--stdin"], { input: content });
  return output.trim();
}

export async function readTreeIntoIndex(layout: GitRepoLayout, indexFile: string, treeish: string): Promise<void> {
  await runGitWrite(layout, ["read-tree", treeish], { env: { GIT_INDEX_FILE: indexFile } });
}

export async function addBlobToIndex(
  layout: GitRepoLayout,
  indexFile: string,
  repoPath: string,
  blobOid: string,
  mode = "100644"
): Promise<void> {
  await runGitWrite(layout, ["update-index", "--add", "--cacheinfo", `${mode},${blobOid},${repoPath}`], {
    env: { GIT_INDEX_FILE: indexFile }
  });
}

export async function removeIndexPath(layout: GitRepoLayout, indexFile: string, repoPath: string): Promise<void> {
  await runGitWrite(layout, ["update-index", "--force-remove", "--", repoPath], {
    env: { GIT_INDEX_FILE: indexFile }
  });
}

export async function writeTreeFromIndex(layout: GitRepoLayout, indexFile: string): Promise<string> {
  const output = await runGitWrite(layout, ["write-tree"], { env: { GIT_INDEX_FILE: indexFile } });
  return output.trim();
}

export async function commitTree(
  layout: GitRepoLayout,
  tree: string,
  parents: string[],
  message: string,
  identity: Record<string, string>
): Promise<string> {
  const parentArgs = parents.flatMap((parent) => ["-p", parent]);
  const output = await runGitWrite(layout, ["commit-tree", tree, ...parentArgs, "-m", message], {
    env: identity
  });
  return output.trim();
}

/** Compare-and-swap ref publication. Returns false when the old value did not match. */
export async function updateRefCas(layout: GitRepoLayout, ref: string, nextOid: string, expectedOid: string): Promise<boolean> {
  const result = await spawnWriteGit(
    layout.worktreeRoot,
    [
      "-C",
      layout.worktreeRoot,
      "-c",
      "core.quotePath=false",
      "-c",
      `core.hooksPath=${emptyHooksDir()}`,
      ...WRITE_CONFIG_OVERRIDES,
      "update-ref",
      ref,
      nextOid,
      expectedOid
    ],
    {}
  );
  if (result.error) {
    throw new KnowledgeError("E_GIT_INVOCATION_FAILED", `Failed to execute git: ${result.error.message}`, {
      exitCode: 70,
      paths: [layout.worktreeRoot]
    });
  }
  return result.status === 0;
}

export interface IndexLock {
  /** Absolute path of the real index file. */
  indexPath: string;
  /** Absolute path of the lock file we hold. */
  lockPath: string;
  release: () => void;
}

/**
 * Acquires the real index lock (exclusive create) so a concurrent `git add` cannot be
 * overwritten during publication. The caller must release it even on failure.
 */
export function acquireIndexLock(layout: GitRepoLayout): IndexLock {
  const indexPath = path.join(layout.gitDir, "index");
  const lockPath = `${indexPath}.lock`;
  try {
    const handle = fs.openSync(lockPath, "wx");
    fs.closeSync(handle);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new KnowledgeError("E_INDEX_LOCKED", "The knowledge repository index is locked by another writer", {
        exitCode: 70,
        paths: [lockPath],
        remediation: "Retry once the other Git operation completes; llmdoc never deletes a foreign index.lock."
      });
    }
    throw new KnowledgeError("E_KNOWLEDGE_WRITE_FAILED", `Failed to acquire the index lock: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [lockPath]
    });
  }
  let released = false;
  return {
    indexPath,
    lockPath,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      try {
        fs.rmSync(lockPath, { force: true });
      } catch {
        // best-effort lock cleanup
      }
    }
  };
}

/** Atomically publishes a prebuilt index by staging it on the lock path and renaming. */
export function publishIndex(lock: IndexLock, builtIndexPath: string): void {
  try {
    fs.copyFileSync(builtIndexPath, lock.lockPath);
    fs.renameSync(lock.lockPath, lock.indexPath);
  } catch (error) {
    throw new KnowledgeError("E_KNOWLEDGE_WRITE_FAILED", `Failed to publish the knowledge index: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [lock.indexPath]
    });
  }
}
