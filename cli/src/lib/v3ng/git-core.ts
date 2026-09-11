import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { NgError, type NgErrorCode } from "./errors.js";
import { realPath } from "./paths.js";

export interface GitRepoLayout {
  worktreeRoot: string;
  gitDir: string;
  commonDir: string;
}

export type GitLayoutProbe =
  | { kind: "worktree"; layout: GitRepoLayout }
  | { kind: "bare"; gitDir: string }
  | { kind: "missing" };

export interface CleanSnapshot {
  available: boolean;
  clean: boolean;
  unavailableReason: string | null;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  conflictedPaths: string[];
}

export interface HeadState {
  headRevision: string | null;
  rawHeadRevision: string | null;
  branch: string | null;
  unborn: boolean;
  detached: boolean;
  pointsToCommit: boolean;
}

export interface GitInvocationOptions {
  allowMissing?: boolean;
  env?: Record<string, string>;
}

export function runGit(layout: GitRepoLayout, args: string[]): Promise<string>;
export function runGit(layout: GitRepoLayout, args: string[], options: GitInvocationOptions & { allowMissing: true }): Promise<string | null>;
export function runGit(
  layout: GitRepoLayout,
  args: string[],
  options: Omit<GitInvocationOptions, "allowMissing"> & { allowMissing?: false }
): Promise<string>;
export async function runGit(layout: GitRepoLayout, args: string[], options: GitInvocationOptions = {}): Promise<string | null> {
  const result = await spawnGitProcess(layout.worktreeRoot, args, options.env);
  if (result.error) {
    throw new NgError("E_GIT_INVOCATION_FAILED", `Failed to execute git: ${result.error.message}`, {
      exitCode: 70,
      paths: [layout.worktreeRoot]
    });
  }
  if (result.status !== 0) {
    if (options.allowMissing) {
      return null;
    }
    const detail = (result.stderr || result.stdout || "git command failed").trim();
    throw new NgError("E_GIT_INVOCATION_FAILED", `git ${args[0] ?? ""} failed: ${detail}`, {
      exitCode: 70,
      paths: [layout.worktreeRoot]
    });
  }
  return result.stdout.trimEnd();
}

interface SpawnGitResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function spawnGitProcess(cwd: string, args: string[], envOverride?: Record<string, string>): Promise<SpawnGitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", cwd, "-c", "core.quotePath=false", "--no-optional-locks", ...args], {
      cwd,
      env: { ...sanitizedGitEnv(), ...envOverride }
    });
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
  });
}

const GIT_ENV_DENY = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_EXTERNAL_DIFF",
  "GIT_EXTERNAL_TEXTCONV",
  "GIT_DIFF_OPTS",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_OPTIONAL_LOCKS",
  "GIT_EDITOR",
  "GIT_SEQUENCE_EDITOR",
  "GIT_PAGER",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND"
]);

const GIT_ENV_DENY_PREFIXES = ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];

function sanitizedGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (GIT_ENV_DENY.has(upper)) {
      continue;
    }
    if (GIT_ENV_DENY_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
      continue;
    }
    env[key] = value;
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

export async function probeGitLayout(startDir: string): Promise<GitLayoutProbe> {
  const bare = await spawnGitText(startDir, ["rev-parse", "--is-bare-repository"]);
  if (bare === null) {
    return { kind: "missing" };
  }
  if (bare.trim() === "true") {
    const gitDir = await spawnGitText(startDir, ["rev-parse", "--absolute-git-dir"]);
    return { kind: "bare", gitDir: gitDir ? realPath(gitDir.trim()) : "" };
  }
  const toplevel = await spawnGitText(startDir, ["rev-parse", "--show-toplevel"]);
  const gitDir = await spawnGitText(startDir, ["rev-parse", "--absolute-git-dir"]);
  const commonDir = await spawnGitText(startDir, ["rev-parse", "--git-common-dir"]);
  if (toplevel === null || gitDir === null || commonDir === null) {
    return { kind: "missing" };
  }
  return {
    kind: "worktree",
    layout: {
      worktreeRoot: realPath(toplevel.trim()),
      gitDir: realPath(gitDir.trim()),
      commonDir: realPath(path.resolve(startDir, commonDir.trim()))
    }
  };
}

export interface ReadCleanSnapshotOptions {
  allowUnavailable?: boolean;
}

export async function readCleanSnapshot(layout: GitRepoLayout, options: ReadCleanSnapshotOptions = {}): Promise<CleanSnapshot> {
  let output: string;
  try {
    output = await runGit(layout, [
      "status",
      "--porcelain",
      "--no-renames",
      "--untracked-files=normal",
      "--ignore-submodules=dirty"
    ]);
  } catch (error) {
    if (options.allowUnavailable && error instanceof NgError) {
      return unavailableCleanSnapshot(error.message);
    }
    throw error;
  }
  const stagedPaths: string[] = [];
  const unstagedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  const conflictedPaths: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.length < 4) {
      continue;
    }
    const xy = line.slice(0, 2);
    const filePath = line.slice(3);
    if (xy === "??") {
      untrackedPaths.push(filePath);
      continue;
    }
    if (CONFLICT_STATUS.has(xy)) {
      conflictedPaths.push(filePath);
      continue;
    }
    if (xy[0] !== " " && xy[0] !== "?") {
      stagedPaths.push(filePath);
    }
    if (xy[1] !== " " && xy[1] !== "?") {
      unstagedPaths.push(filePath);
    }
  }
  stagedPaths.sort();
  unstagedPaths.sort();
  untrackedPaths.sort();
  conflictedPaths.sort();
  return {
    available: true,
    clean: stagedPaths.length + unstagedPaths.length + untrackedPaths.length + conflictedPaths.length === 0,
    unavailableReason: null,
    stagedPaths,
    unstagedPaths,
    untrackedPaths,
    conflictedPaths
  };
}

function unavailableCleanSnapshot(reason: string): CleanSnapshot {
  return {
    available: false,
    clean: false,
    unavailableReason: reason,
    stagedPaths: [],
    unstagedPaths: [],
    untrackedPaths: [],
    conflictedPaths: []
  };
}

export async function readHeadState(layout: GitRepoLayout): Promise<HeadState> {
  const branch = await runGit(layout, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowMissing: true });
  const rawHead = await runGit(layout, ["rev-parse", "--verify", "HEAD"], { allowMissing: true });
  const headCommit =
    rawHead === null ? null : await runGit(layout, ["rev-parse", "--verify", "HEAD^{commit}"], { allowMissing: true });
  return {
    headRevision: headCommit,
    rawHeadRevision: rawHead,
    branch: branch === null ? null : branch,
    unborn: rawHead === null && branch !== null,
    detached: branch === null,
    pointsToCommit: headCommit !== null
  };
}

const CONFLICT_STATUS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

async function spawnGitText(cwd: string, args: string[]): Promise<string | null> {
  const result = await spawnGitProcess(cwd, args);
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout;
}

export function assertDirectory(input: string, code: NgErrorCode, message: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(input));
  } catch {
    throw new NgError(code, `${message} (${input})`, { paths: [input] });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new NgError(code, `${message} (${input})`, { paths: [input] });
  }
  if (!stat.isDirectory()) {
    throw new NgError(code, `${message} (${input})`, { paths: [input] });
  }
  return resolved;
}
