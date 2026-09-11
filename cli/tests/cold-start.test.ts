import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { legacyValidationIssues } from "./helpers.js";

describe("cold-start workflow", () => {
  test("new creates the first llmdoc directory at the nearest Git root", async () => {
    const rootDir = createEmptyGitRepository();
    const nestedDir = path.join(rootDir, "src", "nested");
    fs.mkdirSync(nestedDir, { recursive: true });

    const created = await runCli(
      ["new", "architecture.mdx", "--kind", "architecture", "--description", "仓库整体架构。"],
      nestedDir
    );

    expect(created.exitCode).toBe(0);
    expect(created.stdout).toContain("created: llmdoc/architecture.mdx");
    expect(created.stdout).toContain("init-state");
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "architecture.mdx"))).toBe(true);

    const jsonCreated = await runCli(
      ["--json", "new", "runtime/overview.mdx", "--kind", "reference", "--description", "运行时边界。"],
      nestedDir
    );
    const payload = JSON.parse(jsonCreated.stdout) as { created: string; next: string | null };
    expect(payload.created).toBe("llmdoc/runtime/overview.mdx");
    expect(payload.next).toContain("init-state");
  });

  test("new refuses a directory without a Git repository with an actionable remedy", async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-no-git-"));

    const result = await runCli(["new", "architecture.mdx", "--kind", "architecture"], plainDir);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("git init");
    expect(fs.existsSync(path.join(plainDir, "llmdoc"))).toBe(false);
  });

  test("new preserves the existing non-Git llmdoc compatibility path", async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-existing-no-git-"));
    fs.mkdirSync(path.join(plainDir, "llmdoc"));

    const result = await runCli(["new", "architecture.mdx", "--kind", "architecture"], plainDir);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(plainDir, "llmdoc", "architecture.mdx"))).toBe(true);
  });

  test("init-state explains unborn HEAD and then exposes the validated bootstrap sequence", async () => {
    const rootDir = createEmptyGitRepository();
    const created = await runCli(["new", "architecture.mdx", "--kind", "architecture"], rootDir);
    expect(created.exitCode).toBe(0);

    const missingMeta = legacyValidationIssues(rootDir);
    expect(missingMeta.some((issue) => issue.code === "meta.missing")).toBe(true);
    expect(missingMeta.map((issue) => issue.message).join("\n")).toContain("init-state");

    const unborn = await runCli(["init-state"], rootDir);
    expect(unborn.exitCode).toBe(1);
    expect(unborn.stdout).toContain("HEAD has no commit");
    expect(unborn.stdout).toContain("git commit --allow-empty");

    commitEmpty(rootDir);
    const initialized = await runCli(["--json", "init-state"], rootDir);
    const payload = JSON.parse(initialized.stdout) as { status: string; next: string };
    expect(initialized.exitCode).toBe(0);
    expect(payload.status).toBe("success");
    expect(payload.next).toContain("validate");
    expect(payload.next).toContain("commit --all");
    expect(payload.next).not.toContain("fingerprint");

    const validated = legacyValidationIssues(rootDir);
    expect(validated.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  test("new synchronizes an existing ledger without repeating the bootstrap hint", async () => {
    const rootDir = createEmptyGitRepository();
    await runCli(["new", "architecture.mdx", "--kind", "architecture"], rootDir);
    commitEmpty(rootDir);
    await runCli(["init-state"], rootDir);

    const created = await runCli(
      ["--json", "new", "runtime/details.mdx", "--kind", "guide", "--description", "运行细节。"],
      rootDir
    );
    const payload = JSON.parse(created.stdout) as { created: string; next: string | null };
    expect(created.exitCode).toBe(0);
    expect(payload.next).toBeNull();

    const meta = JSON.parse(fs.readFileSync(path.join(rootDir, "llmdoc", "meta.json"), "utf8")) as {
      documents: Record<string, { validatedRevision: string | null }>;
    };
    expect(meta.documents["runtime/details.mdx"]).toEqual({ validatedRevision: null });
  });
});

function createEmptyGitRepository(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-cold-start-"));
  runGit(rootDir, ["init", "--quiet"]);
  runGit(rootDir, ["config", "user.email", "test@example.com"]);
  runGit(rootDir, ["config", "user.name", "Test User"]);
  return rootDir;
}

function commitEmpty(rootDir: string): void {
  runGit(rootDir, ["commit", "--allow-empty", "--quiet", "-m", "initial commit"]);
}

function runGit(rootDir: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  }
}
