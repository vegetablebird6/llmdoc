import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { commitAll, createFixture, removeGitDirectory, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("hook commands fail-open and preserve their text/json contracts", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "src/api/retry.ts", "export function isRetryable() { return false; }\n");
    commitAll(rootDir, "retry update");

    const sessionStart = await runCli(["hook", "session-start"], rootDir, JSON.stringify({ source: "compact" }));
    expect(sessionStart.exitCode).toBe(0);
    expect(sessionStart.stdout).toContain("compact re-entry");
    expect(sessionStart.stdout).toContain("llmdoc skill");
    expect(sessionStart.stdout).toContain("investigator");
    expect(sessionStart.stdout).toContain("/llmdoc:update");
    expect(sessionStart.stdout).not.toMatch(/[\p{Script=Han}]/u);

    const stop = await runCli(["hook", "stop"], rootDir);
    const stopJson = JSON.parse(stop.stdout) as { continue: boolean; systemMessage?: string };
    expect(stop.exitCode).toBe(0);
    expect(Object.keys(stopJson).every((key) => key === "continue" || key === "systemMessage")).toBe(true);
    expect(stopJson.continue).toBe(true);
    expect(stop.stdout).not.toMatch(/[\p{Script=Han}]/u);

    const compact = await runCli(["hook", "compact"], rootDir);
    const compactJson = JSON.parse(compact.stdout) as { continue: boolean; systemMessage?: string };
    expect(compact.exitCode).toBe(0);
    expect(compactJson.continue).toBe(true);
    expect(compactJson.systemMessage).toContain("LLMDOC_STATE");
    expect(compactJson.systemMessage).toContain("lesson_candidates");
    expect(compact.stdout).not.toMatch(/[\p{Script=Han}]/u);

    removeGitDirectory(rootDir);
    const degradedStop = await runCli(["hook", "stop"], rootDir);
    expect(degradedStop.exitCode).toBe(0);
    expect(() => JSON.parse(degradedStop.stdout)).not.toThrow();
  });

  test("fingerprint follow-up commits stay quiet in lifecycle hooks", async () => {
    const rootDir = createFixture();
    fs.appendFileSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"), "\n补充一段稳定知识。\n");

    commitAll(rootDir, "docs(llmdoc): update");
    const fingerprint = await runCli(["--json", "fingerprint", "--all"], rootDir);
    expect(fingerprint.exitCode).toBe(0);
    commitAll(rootDir, "chore(llmdoc): refresh fingerprints");

    // fingerprint 后的 meta follow-up 会让 raw baseline 天然落后 1 commit，但它不是可执行的更新信号。
    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.exitCode).toBe(0);
    expect(sessionStart.stdout).toContain("documents have no actionable impacts");
    expect(sessionStart.stdout).not.toContain("behind HEAD");

    const stop = await runCli(["hook", "stop"], rootDir);
    const stopJson = JSON.parse(stop.stdout) as { continue: boolean; systemMessage?: string };
    expect(stopJson.continue).toBe(true);
    expect(stopJson.systemMessage).toBeUndefined();
  });

  test("pending reflection candidates trigger hook signals without a code delta", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, ".llmdoc-tmp/reflections/pending/user-correction.md", "# 用户纠正\n");
    writeRepoFile(rootDir, ".llmdoc-tmp/reflections/pending/test-failure.md", "# 测试失败\n");
    writeRepoFile(rootDir, ".llmdoc-tmp/reflections/pending/notes.txt", "not a candidate\n");

    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.exitCode).toBe(0);
    expect(sessionStart.stdout).toContain("2 pending reflection candidate(s)");

    const stop = await runCli(["hook", "stop"], rootDir);
    const stopJson = JSON.parse(stop.stdout) as { continue: boolean; systemMessage?: string };
    expect(stop.exitCode).toBe(0);
    expect(stopJson.continue).toBe(true);
    expect(stopJson.systemMessage).toContain("2 reflection candidate(s) pending");
    expect(stopJson.systemMessage).toContain("/llmdoc:update --reflection");
    expect(stopJson.systemMessage).not.toContain("user-correction.md");
    expect(stopJson.systemMessage).not.toContain("test-failure.md");
  });

  test("hooks omit reflection signals when no pending markdown candidates exist", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, ".llmdoc-tmp/reflections/pending/notes.txt", "not a candidate\n");

    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.stdout).not.toContain("reflection candidate");

    const stop = await runCli(["hook", "stop"], rootDir);
    expect(JSON.parse(stop.stdout)).toEqual({ continue: true });
  });

  test("hooks stay silent in repositories without llmdoc", async () => {
    // 回归 M3:未启用 llmdoc 的项目不应被注入任何 hook 噪音。
    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-bare-"));

    const sessionStart = await runCli(["hook", "session-start"], bareDir);
    expect(sessionStart.exitCode).toBe(0);
    expect(sessionStart.stdout).toBe("");

    const stop = await runCli(["hook", "stop"], bareDir);
    expect(stop.exitCode).toBe(0);
    expect(JSON.parse(stop.stdout)).toEqual({ continue: true });

    const compact = await runCli(["hook", "compact"], bareDir);
    expect(compact.exitCode).toBe(0);
    expect(JSON.parse(compact.stdout)).toEqual({ continue: true });

    // 回归:不得越过当前 Git 根目录，把同级名为 llmdoc 的仓库误认为知识目录。
    const workspaceParent = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-sibling-"));
    const siblingRepository = path.join(workspaceParent, "llmdoc");
    const unrelatedRepository = path.join(workspaceParent, "website");
    fs.mkdirSync(siblingRepository);
    fs.mkdirSync(path.join(unrelatedRepository, ".git"), { recursive: true });

    const isolatedSessionStart = await runCli(["hook", "session-start"], unrelatedRepository);
    expect(isolatedSessionStart.exitCode).toBe(0);
    expect(isolatedSessionStart.stdout).toBe("");

    const enabledRepository = createFixture();
    const nestedDirectory = path.join(enabledRepository, "src", "api");
    const nestedSessionStart = await runCli(["hook", "session-start"], nestedDirectory);
    expect(nestedSessionStart.exitCode).toBe(0);
    expect(nestedSessionStart.stdout).toContain("llmdoc cold start");
  });
});
