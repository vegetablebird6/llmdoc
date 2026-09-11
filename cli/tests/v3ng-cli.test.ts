import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { runCli } from "../src/cli.js";
import { commitFile, head, initRepo, makeTempDir, realPath, snapshotWorktree, sourceIndexBytes } from "./v3ng-helpers.js";

const createdDirs: string[] = [];

function defaultRegistryFile(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? "", "llmdoc", "bindings.json");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "llmdoc", "bindings.json");
}

function defaultRegistryState(): { exists: boolean; digest: string | null } {
  const filePath = defaultRegistryFile();
  if (!fs.existsSync(filePath)) {
    return { exists: false, digest: null };
  }
  return { exists: true, digest: createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") };
}

let realRegistryBefore: { exists: boolean; digest: string | null };

beforeAll(() => {
  realRegistryBefore = defaultRegistryState();
});

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort cleanup of temp fixtures
    }
  }
  expect(defaultRegistryState()).toEqual(realRegistryBefore);
});

async function withRegistryEnv<T>(run: () => T | Promise<T>): Promise<{ result: T; registryDir: string }> {
  const registryBase = makeTempDir("llmdoc-v3ng-cli-reg-");
  createdDirs.push(registryBase);
  const isWin = process.platform === "win32";
  const key = isWin ? "APPDATA" : "XDG_CONFIG_HOME";
  const previous = process.env[key];
  process.env[key] = registryBase;
  try {
    return { result: await run(), registryDir: path.join(registryBase, "llmdoc") };
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

describe("v3-ng CLI surface (bind/init)", () => {
  it("init creates the knowledge repository and bind is idempotent; JSON output validates", async () => {
    const base = makeTempDir("llmdoc-v3ng-cli-");
    createdDirs.push(base);
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    const knowledge = `${base}/knowledge`;

    const { result: sharedRuns, registryDir } = await withRegistryEnv(async () => {
      const initResult = await runCli(["--json", "init", "--source", source, "--knowledge", knowledge], base);
      const bindResult = await runCli(["--json", "bind", "--source", source, "--knowledge", knowledge], base);
      return { initResult, bindResult };
    });
    const { initResult, bindResult } = sharedRuns;
    expect(initResult.exitCode).toBe(0);
    const initPayload = JSON.parse(initResult.stdout) as { repositoryId: string; knowledgeCommit: string };
    expect(initPayload.repositoryId).toMatch(/^llmdoc-[0-9a-f]{32}$/);
    expect(fs.existsSync(path.join(registryDir, "bindings.json"))).toBe(true);

    expect(bindResult.exitCode).toBe(0);
    const bindPayload = JSON.parse(bindResult.stdout) as { status: string; repositoryId: string };
    expect(bindPayload.status).toBe("already-bound");
    expect(bindPayload.repositoryId).toBe(initPayload.repositoryId);
  });

  it("renders NgError as {error:{code,message,paths,remediation}} in JSON mode with the protocol exit code", async () => {
    const base = makeTempDir("llmdoc-v3ng-clierr-");
    createdDirs.push(base);
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    const missing = `${base}/no-git-here`;
    fs.mkdirSync(missing);

    const jsonResult = (
      await withRegistryEnv(() => runCli(["--json", "bind", "--source", source, "--knowledge", missing], base))
    ).result;
    expect(jsonResult.exitCode).toBe(2);
    const payload = JSON.parse(jsonResult.stdout) as {
      error: { code: string; message: string; paths: string[]; remediation: string };
    };
    expect(payload.error.code).toBe("E_KNOWLEDGE_REPO_NOT_FOUND");
    expect(Array.isArray(payload.error.paths)).toBe(true);
    expect(typeof payload.error.remediation).toBe("string");

    const textResult = (await withRegistryEnv(() => runCli(["bind", "--source", source, "--knowledge", missing], base)))
      .result;
    expect(textResult.exitCode).toBe(2);
    expect(textResult.stdout).toContain("Remediation:");
  });

  it("refuses non-empty init targets and nested mode without the explicit flag", async () => {
    const base = makeTempDir("llmdoc-v3ng-clineg-");
    createdDirs.push(base);
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    fs.mkdirSync(`${base}/knowledge`);
    fs.writeFileSync(`${base}/knowledge/keep.txt`, "keep\n");

    const notEmptyResult = (
      await withRegistryEnv(() =>
        runCli(["--json", "init", "--source", source, "--knowledge", `${base}/knowledge`], base)
      )
    ).result;
    expect(notEmptyResult.exitCode).toBe(2);
    expect((JSON.parse(notEmptyResult.stdout) as { error: { code: string } }).error.code).toBe("E_INIT_TARGET_NOT_EMPTY");
    expect(fs.readFileSync(`${base}/knowledge/keep.txt`, "utf8")).toBe("keep\n");

    const nestedResult = (
      await withRegistryEnv(() =>
        runCli(["--json", "init", "--source", source, "--knowledge", `${base}/source/knowledge`], base)
      )
    ).result;
    expect(nestedResult.exitCode).toBe(2);
    expect((JSON.parse(nestedResult.stdout) as { error: { code: string } }).error.code).toBe("E_NESTED_MODE_REQUIRED");
    expect(fs.existsSync(`${base}/source/knowledge`)).toBe(false);
  });

  it("preserves the source repository byte-identically across CLI init and bind", async () => {
    const base = makeTempDir("llmdoc-v3ng-clifrozen-");
    createdDirs.push(base);
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    commitFile(source, "src/api/retry.ts", "export function isRetryable() { return true; }\n", "more");

    const headBefore = head(source);
    const indexBefore = sourceIndexBytes(realPath(source));
    const filesBefore = snapshotWorktree(realPath(source));
    const statusBefore = (await runCli(["--json", "--version"], base)).stdout;

    await withRegistryEnv(() => runCli(["init", "--source", source, "--knowledge", `${base}/knowledge`], base));
    await withRegistryEnv(() => runCli(["bind", "--source", source, "--knowledge", `${base}/knowledge`], base));

    expect(head(source)).toBe(headBefore);
    expect(sourceIndexBytes(realPath(source)).equals(indexBefore)).toBe(true);
    expect(snapshotWorktree(realPath(source))).toEqual(filesBefore);
    expect((await runCli(["--json", "--version"], base)).stdout).toBe(statusBefore);
  });

  it("renders E_FILESYSTEM_IO as ngError JSON when the registry root is unusable", async () => {
    const base = makeTempDir("llmdoc-v3ng-clir6-");
    createdDirs.push(base);
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    const unusableRoot = `${base}/appdata-file`;
    fs.writeFileSync(unusableRoot, "not a directory");
    const key = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
    const previous = process.env[key];
    process.env[key] = unusableRoot;
    try {
      const result = await runCli(["--json", "init", "--source", source, "--knowledge", `${base}/knowledge`], base);
      expect(result.exitCode).toBe(70);
      const payload = JSON.parse(result.stdout) as {
        error: { code: string; message: string; paths: string[]; remediation: string };
      };
      expect(payload.error.code).toBe("E_FILESYSTEM_IO");
      expect(payload.error.paths.length).toBeGreaterThan(0);
      expect(typeof payload.error.message).toBe("string");
      expect(typeof payload.error.remediation).toBe("string");
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("keeps --version and legacy commands working", async () => {
    const version = await runCli(["--version"], process.cwd());
    expect(version.exitCode).toBe(0);
  });
});
