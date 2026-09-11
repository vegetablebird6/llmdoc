import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { commitAll, createFixture, stageFile, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("status and delta reflect committed, dirty, unmapped, and scope-aware git state", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "src/api/retry.ts", "export function isRetryable() { return false; }\n");
    commitAll(rootDir, "change retry behavior");
    writeRepoFile(rootDir, "src/api/errors.ts", "export const RETRYABLE = ['timeout', 'network'];\n");
    stageFile(rootDir, "src/api/errors.ts");
    writeRepoFile(rootDir, "src/new-feature.ts", "export const fresh = true;\n");

    const status = await runCli(["status", "--json"], rootDir);
    const statusJson = JSON.parse(status.stdout) as {
      commitsBehindHead: number;
      documents: { impacted: number; dirty: number };
      unmapped: { committed: string[]; dirty: string[] };
    };
    expect(statusJson.commitsBehindHead).toBe(1);
    expect(statusJson.documents.impacted).toBeGreaterThanOrEqual(1);
    expect(statusJson.documents.dirty).toBeGreaterThanOrEqual(1);
    expect(statusJson.unmapped.dirty).toContain("src/new-feature.ts");

    const delta = await runCli(["delta", "--scope", "api-client", "--json"], rootDir);
    const deltaJson = JSON.parse(delta.stdout) as {
      suggestedMode: string;
      impacted: Array<{ path: string; changedCommittedPaths: string[]; dirtyPaths: string[] }>;
    };
    expect(deltaJson.suggestedMode).toBe("deep");
    expect(deltaJson.impacted.some((item) => item.path === "llmdoc/api-client/retry-policy.mdx")).toBe(true);
  });

  test("llmdoc and tmp-only changes do not become unmapped update signals", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "llmdoc/api-client/overview.mdx", "---\ndescription: API client 的边界与路由。\nkind: reference\n---\n\n# API Client\n");
    writeRepoFile(rootDir, ".llmdoc-tmp/records/note.md", "scratch\n");

    const status = await runCli(["status", "--json"], rootDir);
    const statusJson = JSON.parse(status.stdout) as { unmapped: { dirty: string[] } };
    expect(statusJson.unmapped.dirty).toEqual([]);

    const stop = await runCli(["hook", "stop"], rootDir);
    const stopJson = JSON.parse(stop.stdout) as { continue: boolean; systemMessage?: string };
    expect(stopJson.continue).toBe(true);
    expect(stopJson.systemMessage).toBeUndefined();
  });

  test("non-ascii paths survive git status parsing", async () => {
    // 回归 H2:中文文件名不得以八进制转义形式出现,否则与 code.paths 永不匹配。
    const rootDir = createFixture();
    writeRepoFile(rootDir, "src/api/中文模块.ts", "export const 中文 = true;\n");

    const status = await runCli(["--json", "status"], rootDir);
    const payload = JSON.parse(status.stdout) as { unmapped: { dirty: string[] } };
    expect(payload.unmapped.dirty).toContain("src/api/中文模块.ts");
    expect(payload.unmapped.dirty.some((item) => item.includes("\\"))).toBe(false);
  });

  test("llmdocignore filters unmapped noise", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "data/state.sqlite3", "binary-ish\n");
    writeRepoFile(rootDir, "notes.local.md", "scratch\n");
    writeRepoFile(rootDir, ".llmdocignore", "# local runtime files\ndata/\n*.local.md\n");

    const status = await runCli(["--json", "status"], rootDir);
    const payload = JSON.parse(status.stdout) as { unmapped: { dirty: string[] } };
    expect(payload.unmapped.dirty).not.toContain("data/state.sqlite3");
    expect(payload.unmapped.dirty).not.toContain("notes.local.md");
    // .llmdocignore 本身是 untracked 的,不在忽略清单里则会出现——把它也忽略掉不是默认行为
  });

  test("status distinguishes metadata-only commits behind baseline from relevant source commits", async () => {
    const rootDir = createFixture();
    fs.appendFileSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"), "\n补充一段稳定知识。\n");
    const finalize = await runCli(["--json", "commit", "--all", "-m", "docs(llmdoc): update"], rootDir);
    expect(finalize.exitCode).toBe(0);

    // 收尾成功后 baseline 只落后自己的 meta follow-up commit,不代表知识过期
    const status = await runCli(["--json", "status"], rootDir);
    const payload = JSON.parse(status.stdout) as { commitsBehindHead: number; relevantCommitsBehindHead: number };
    expect(payload.commitsBehindHead).toBe(1);
    expect(payload.relevantCommitsBehindHead).toBe(0);

    const text = await runCli(["status"], rootDir);
    expect(text.stdout).toContain("metadata-only; knowledge clean");

    writeRepoFile(rootDir, "src/api/retry.ts", "export function isRetryable() { return false; }\n");
    commitAll(rootDir, "change source");
    const statusAfterSource = await runCli(["--json", "status"], rootDir);
    const payloadAfterSource = JSON.parse(statusAfterSource.stdout) as {
      commitsBehindHead: number;
      relevantCommitsBehindHead: number;
    };
    expect(payloadAfterSource.commitsBehindHead).toBe(2);
    expect(payloadAfterSource.relevantCommitsBehindHead).toBe(1);
  });
});
