import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { commitAll, createFixture, detachHead, readMeta, stageFile, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("delta uses per-document validatedRevision while unmapped still follows baseline", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "src/api/retry.ts", "export function isRetryable() { return false; }\n");
    commitAll(rootDir, "retry update");
    const refreshed = await runCli(["fingerprint", "--update", "api-client/retry-policy.mdx"], rootDir);
    expect(refreshed.exitCode).toBe(0);

    writeRepoFile(rootDir, "src/api/errors.ts", "export const RETRYABLE = ['timeout', 'network'];\n");
    commitAll(rootDir, "error update");

    const delta = await runCli(["delta", "--json"], rootDir);
    const deltaJson = JSON.parse(delta.stdout) as {
      impacted: Array<{ path: string }>;
      unmapped: { committed: string[] };
    };
    expect(deltaJson.impacted.some((item) => item.path === "llmdoc/api-client/retry-policy.mdx")).toBe(false);
    expect(deltaJson.impacted.some((item) => item.path === "llmdoc/api-client/error-model.mdx")).toBe(true);

    writeRepoFile(rootDir, "src/unmapped.ts", "export const x = 1;\n");
    commitAll(rootDir, "unmapped");
    const withUnmapped = await runCli(["delta", "--json"], rootDir);
    const withUnmappedJson = JSON.parse(withUnmapped.stdout) as { unmapped: { committed: string[] } };
    expect(withUnmappedJson.unmapped.committed).toContain("src/unmapped.ts");
  });

  test("delta treats missing or nonexistent per-document revision as degraded impacted state, never false-clean", async () => {
    const rootDir = createFixture();
    const metaPath = path.join(rootDir, "llmdoc", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      documents: Record<string, { validatedRevision?: string }>;
    };
    delete meta.documents["api-client/retry-policy.mdx"];
    meta.documents["api-client/error-model.mdx"]!.validatedRevision = "cafebabe";
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

    const delta = await runCli(["delta", "--json"], rootDir);
    const deltaJson = JSON.parse(delta.stdout) as {
      suggestedMode: string;
      reasons: string[];
      impacted: Array<{ path: string; changedCommittedPaths: string[]; dirtyPaths: string[] }>;
    };
    expect(deltaJson.suggestedMode).toBe("deep");
    expect(deltaJson.reasons.some((reason) => reason.includes("has no validatedRevision"))).toBe(true);
    expect(deltaJson.reasons.some((reason) => reason.includes("does not exist in current Git history"))).toBe(true);
    expect(deltaJson.impacted.some((item) => item.path === "llmdoc/api-client/retry-policy.mdx")).toBe(true);
    expect(deltaJson.impacted.some((item) => item.path === "llmdoc/api-client/error-model.mdx")).toBe(true);
  });

  test("fingerprint updates selected docs only, blocks dirty code, and all-mode advances baseline unless detached", async () => {
    const rootDir = createFixture();
    writeRepoFile(rootDir, "src/api/retry.ts", "export function isRetryable() { return false; }\n");
    commitAll(rootDir, "retry update");

    const before = readMeta(rootDir);
    const partial = await runCli(["fingerprint", "--update", "api-client/retry-policy.mdx", "--json"], rootDir);
    const partialJson = JSON.parse(partial.stdout) as { updated: string[]; baselineRevision: string };
    const afterPartial = readMeta(rootDir);
    expect(partialJson.updated).toEqual(["api-client/retry-policy.mdx"]);
    expect(afterPartial.documents["api-client/retry-policy.mdx"].validatedRevision).not.toBe(
      before.documents["api-client/retry-policy.mdx"].validatedRevision
    );
    expect(afterPartial.baseline.revision).toBe(before.baseline.revision);

    writeRepoFile(rootDir, "src/api/errors.ts", "export const RETRYABLE = ['timeout', 'network'];\n");
    const blocked = await runCli(["fingerprint", "--update", "api-client/error-model.mdx"], rootDir);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stdout).toContain("dirty");

    writeRepoFile(rootDir, "src/unmapped.ts", "export const UNMAPPED = true;\n");
    const blockedAll = await runCli(["fingerprint", "--all"], rootDir);
    expect(blockedAll.exitCode).toBe(1);
    expect(blockedAll.stdout).toContain("api-client/error-model.mdx");

    stageFile(rootDir, "src/api/errors.ts");
    commitAll(rootDir, "error update");
    // 与任何文档 code.paths 无关的 untracked 文件不阻塞全量 fingerprint。
    const all = await runCli(["fingerprint", "--all", "--json"], rootDir);
    const allJson = JSON.parse(all.stdout) as { baselineRevision: string };
    const afterAll = readMeta(rootDir);
    expect(afterAll.baseline.revision).toBe(allJson.baselineRevision);
    fs.rmSync(path.join(rootDir, "src", "unmapped.ts"));

    // detached HEAD 指向真实 commit,允许推进;只有 merge/rebase/cherry-pick 中间态才阻塞。
    detachHead(rootDir);
    const detached = await runCli(["fingerprint", "--all"], rootDir);
    expect(detached.exitCode).toBe(0);
  });
});
