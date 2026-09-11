import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { createFixture, readMeta, stageFile, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("commit finalizes llmdoc writes as docs+meta commits with fingerprints", async () => {
    const rootDir = createFixture();
    fs.appendFileSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"), "\n新增一段稳定知识。\n");
    // 用户 stage 的非 llmdoc 文件不得被卷入
    writeRepoFile(rootDir, "src/unrelated.ts", "export const X = 1;\n");
    stageFile(rootDir, "src/unrelated.ts");

    const result = await runCli(["--json", "commit", "-m", "docs(llmdoc): test update"], rootDir);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { status: string; commits: string[]; updated: string[] };
    expect(payload.status).toBe("success");
    expect(payload.commits).toHaveLength(2);
    expect(payload.updated).toEqual(["api-client/retry-policy.mdx"]);

    const { spawnSync } = await import("node:child_process");
    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: rootDir, encoding: "utf8" }).stdout;
    expect(staged).toContain("src/unrelated.ts");
    const lastTwo = spawnSync("git", ["log", "-2", "--name-only", "--pretty=%s"], { cwd: rootDir, encoding: "utf8" }).stdout;
    expect(lastTwo).toContain("refresh fingerprints");
    expect(lastTwo).not.toContain("src/unrelated.ts");

    const again = await runCli(["commit"], rootDir);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("no_change");
  });

  test("commit fingerprints the union of changed and explicitly verified documents", async () => {
    const rootDir = createFixture();
    fs.appendFileSync(path.join(rootDir, "llmdoc", "api-client", "error-model.mdx"), "\n补充错误边界。\n");

    const result = await runCli(
      ["--json", "commit", "--verified", "api-client/retry-policy.mdx", "-m", "docs(llmdoc): union"],
      rootDir
    );
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { commits: string[]; updated: string[] };
    expect(payload.commits).toHaveLength(2);
    expect(payload.updated).toEqual(["api-client/error-model.mdx", "api-client/retry-policy.mdx"]);
    const meta = readMeta(rootDir);
    expect(meta.documents["api-client/error-model.mdx"].validatedRevision).toBe(payload.commits[0]);
    expect(meta.documents["api-client/retry-policy.mdx"].validatedRevision).toBe(payload.commits[0]);
  });

  test("commit fails closed before creating any commit when mapped source is dirty", async () => {
    const rootDir = createFixture();
    // 被 code.paths 映射的源码保持未提交,llmdoc 写集有变更 → fingerprint 预检必须在任何 commit 前拒绝
    fs.appendFileSync(path.join(rootDir, "src", "api", "retry.ts"), "// dirty change\n");
    fs.appendFileSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"), "\n新增一段。\n");

    const { spawnSync } = await import("node:child_process");
    const headBefore = spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).stdout.trim();

    const result = await runCli(["commit", "--all", "-m", "repro: llmdoc partial commit"], rootDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("no commit was created");

    const headAfter = spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).stdout.trim();
    expect(headAfter).toBe(headBefore);
    // llmdoc 写集仍 dirty,修复源码后可直接重跑 commit
    const porcelain = spawnSync("git", ["status", "--porcelain", "--", "llmdoc"], { cwd: rootDir, encoding: "utf8" }).stdout;
    expect(porcelain.trim()).not.toBe("");
  });
});
