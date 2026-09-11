import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { commitAll, createFixture, readMeta, stageFile, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("commit --verified creates one meta-only commit and preserves unrelated staged files", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "src/api/retry.ts", "export function isRetryable() { return false; }\n");
    commitAll(rootDir, "change retry behavior");

    const { spawnSync } = await import("node:child_process");
    const verifiedRevision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).stdout.trim();
    writeRepoFile(rootDir, "src/unrelated.ts", "export const staged = true;\n");
    stageFile(rootDir, "src/unrelated.ts");

    const result = await runCli(
      ["--json", "commit", "--verified", "api-client/retry-policy.mdx"],
      rootDir
    );
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { status: string; commits: string[]; updated: string[] };
    expect(payload.status).toBe("success");
    expect(payload.commits).toHaveLength(1);
    expect(payload.updated).toEqual(["api-client/retry-policy.mdx"]);
    expect(readMeta(rootDir).documents["api-client/retry-policy.mdx"].validatedRevision).toBe(verifiedRevision);

    const committedPaths = spawnSync("git", ["show", "--pretty=", "--name-only", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8"
    }).stdout.trim();
    expect(committedPaths).toBe("llmdoc/meta.json");
    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: rootDir, encoding: "utf8" }).stdout;
    expect(staged).toContain("src/unrelated.ts");

    const again = await runCli(["--json", "commit", "--verified", "llmdoc/api-client/retry-policy.mdx"], rootDir);
    expect(again.exitCode).toBe(0);
    expect(JSON.parse(again.stdout)).toEqual({ status: "no_change", commits: [], updated: [] });
  });

  test("commit --all can advance stale revisions with a meta-only commit and then becomes a no-op", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "src/api/retry.ts", "export function isRetryable() { return false; }\n");
    commitAll(rootDir, "change retry behavior");

    const { spawnSync } = await import("node:child_process");
    const verifiedRevision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).stdout.trim();
    const result = await runCli(["--json", "commit", "--all"], rootDir);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      commits: string[];
      updated: string[];
      baselineAdvanced: boolean;
    };
    expect(payload.status).toBe("success");
    expect(payload.commits).toHaveLength(1);
    expect(payload.updated).toHaveLength(4);
    expect(payload.baselineAdvanced).toBe(true);
    const meta = readMeta(rootDir);
    expect(meta.baseline.revision).toBe(verifiedRevision);
    expect(Object.values(meta.documents).every((entry) => entry.validatedRevision === verifiedRevision)).toBe(true);

    const again = await runCli(["--json", "commit", "--all"], rootDir);
    expect(again.exitCode).toBe(0);
    expect(JSON.parse(again.stdout)).toEqual({ status: "no_change", commits: [], updated: [] });
  });

  test("commit --verified rejects conflicts and invalid paths, and preflights even an otherwise current document", async () => {
    const rootDir = createFixture();

    const conflict = await runCli(["commit", "--all", "--verified", "api-client/retry-policy.mdx"], rootDir);
    expect(conflict.exitCode).not.toBe(0);
    expect(conflict.stdout).toContain("cannot use --all and --verified together");

    const missing = await runCli(["commit", "--verified", "api-client/missing.mdx"], rootDir);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stdout).toContain("Document does not exist");

    fs.appendFileSync(path.join(rootDir, "src", "api", "retry.ts"), "// dirty change\n");
    const blocked = await runCli(["commit", "--verified", "api-client/retry-policy.mdx"], rootDir);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stdout).toContain("Fingerprint preflight failed");
  });
});
