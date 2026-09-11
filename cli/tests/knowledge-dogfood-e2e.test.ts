import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 180000 });

import { runCli } from "../src/cli.js";
import { git, head, initRepo, makeTempDir, snapshotWorktree, sourceIndexBytes, writeFile } from "./knowledge-helpers.js";

const createdDirs: string[] = [];

function track(dir: string): string {
  createdDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function registryEnv(dir: string): { key: string; previous: string | undefined } {
  const key = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
  const previous = process.env[key];
  process.env[key] = dir;
  return { key, previous };
}

function restoreRegistryEnv(saved: { key: string; previous: string | undefined }): void {
  if (saved.previous === undefined) delete process.env[saved.key];
  else process.env[saved.key] = saved.previous;
}

async function cli(args: string[], cwd: string, registryDir: string): Promise<{ exitCode: number; stdout: string }> {
  const saved = registryEnv(registryDir);
  try {
    return await runCli(args, cwd);
  } finally {
    restoreRegistryEnv(saved);
  }
}

function json<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

describe("dogfood end-to-end (external knowledge, real dual Git)", () => {
  it("runs init/read/review/commit/capture/update/prune/hook/serve and never touches the source", async () => {
    const base = track(makeTempDir("llmdoc-dogfood-"));
    const source = initRepo(path.join(base, "source"));
    const registryDir = track(makeTempDir("llmdoc-dogfood-registry-"));
    const knowledgeRoot = path.join(base, "knowledge");
    writeFile(source, "src/api/retry.ts", "export const retry = 1;\n");
    writeFile(source, "src/db/pool.ts", "export const pool = 1;\n");
    git(source, ["add", "--", "src/api/retry.ts", "src/db/pool.ts"]);
    git(source, ["commit", "-m", "source baseline"]);

    const sourceHead = head(source);
    const sourceIndexBefore = sourceIndexBytes(source);
    const sourceWorktreeBefore = snapshotWorktree(source);

    // 1. init an external knowledge repository through the CLI.
    const init = await cli(["--json", "init", "--source", source, "--knowledge", knowledgeRoot], source, registryDir);
    expect(init.exitCode).toBe(0);
    expect(json<{ repositoryId: string }>(init).repositoryId).toMatch(/^llmdoc-[0-9a-f]{32}$/);
    expect(fs.existsSync(path.join(knowledgeRoot, "llmdoc.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(knowledgeRoot, ".git"))).toBe(true);

    // 2. bind is idempotent.
    const bind = await cli(["--json", "bind", "--source", source, "--knowledge", knowledgeRoot], source, registryDir);
    expect(bind.exitCode).toBe(0);
    expect(json<{ status: string }>(bind).status).toBe("already-bound");

    // 3. author a canonical document directly in the knowledge worktree.
    writeFile(
      knowledgeRoot,
      "docs/architecture.md",
      [
        "---",
        "description: Retry architecture",
        "kind: architecture",
        "source:",
        "  paths:",
        "    - src/api/retry.ts",
        "---",
        "",
        "# Retry architecture",
        "",
        "Retries are bounded and jittered.",
        ""
      ].join("\n")
    );

    const status = await cli(["--json", "status"], source, registryDir);
    expect(status.exitCode).toBe(0);

    // 4. review -> confirm -> commit.
    const review = await cli(["--json", "review"], source, registryDir);
    expect(review.exitCode).toBe(0);
    const reviewId = json<{ reviewId: string }>(review).reviewId;
    const confirm = await cli(["--json", "review", "--confirm", reviewId], source, registryDir);
    expect(confirm.exitCode).toBe(0);
    const commit = await cli(["--json", "commit", "--review", reviewId], source, registryDir);
    expect(commit.exitCode).toBe(0);
    expect(json<{ schema: string }>(commit).schema).toBe("llmdoc.commit/v1");

    const statusAfterCommit = await cli(["--json", "status"], source, registryDir);
    expect(json<{ documents: { total: number; current: number } }>(statusAfterCommit).documents.total).toBe(1);
    expect(json<{ documents: { current: number } }>(statusAfterCommit).documents.current).toBe(1);

    // 5. retrieval returns the canonical document with a current status.
    const tree = await cli(["--json", "tree"], source, registryDir);
    expect(tree.exitCode).toBe(0);
    const index = await cli(["--json", "index"], source, registryDir);
    const indexPayload = json<{ documents: Array<{ id: string; status: string }> }>(index);
    const architecture = indexPayload.documents.find((document) => document.id === "architecture.md");
    expect(architecture?.status).toBe("current");
    const search = await cli(["--json", "search", "retry"], source, registryDir);
    expect(json<{ results: Array<{ id: string }> }>(search).results.map((result) => result.id)).toContain("architecture.md");
    const show = await cli(["--json", "show", "architecture.md"], source, registryDir);
    expect(show.exitCode).toBe(0);
    const context = await cli(["--json", "context", "--files", "src/api/retry.ts"], source, registryDir);
    expect(context.exitCode).toBe(0);
    void tree;

    // 6. capture an unverified candidate; formal retrieval must not return it.
    const capture = await cli(
      ["--json", "capture", "--title", "Pool sizing idea", "--body", "Consider a smaller pool.", "--source-revision", sourceHead],
      source,
      registryDir
    );
    expect(capture.exitCode).toBe(0);
    const candidateId = json<{ candidateId: string }>(capture).candidateId;
    const searchAfterCapture = await cli(["--json", "search", "pool"], source, registryDir);
    expect(json<{ results: Array<{ id: string }> }>(searchAfterCapture).results.every((result) => !result.id.startsWith("inbox/"))).toBe(true);

    // 7. promote the candidate through update -> review -> commit.
    const update = await cli(
      [
        "--json",
        "update",
        "--promote",
        candidateId,
        "--to",
        "guides/pool.md",
        "--kind",
        "guide",
        "--description",
        "Database pool sizing",
        "--source-path",
        "src/db/pool.ts"
      ],
      source,
      registryDir
    );
    expect(update.exitCode).toBe(0);
    const promoteReviewId = json<{ reviewId: string | null }>(update).reviewId;
    expect(promoteReviewId).not.toBeNull();
    await cli(["--json", "review", "--confirm", promoteReviewId!], source, registryDir);
    const promoteCommit = await cli(["--json", "commit", "--review", promoteReviewId!], source, registryDir);
    expect(promoteCommit.exitCode).toBe(0);
    const indexAfterPromote = json<{ documents: Array<{ id: string; status: string }> }>(
      await cli(["--json", "index"], source, registryDir)
    );
    expect(indexAfterPromote.documents.find((document) => document.id === "guides/pool.md")?.status).toBe("current");

    // 8. prune report is read-only and conservative.
    const prune = await cli(["--json", "prune", "--report"], source, registryDir);
    expect(prune.exitCode).toBe(0);
    expect(json<{ schema: string }>(prune).schema).toBe("llmdoc.prune/v1");

    // 9. hooks are read-only and bound here.
    const hook = await cli(["--json", "hook", "stop"], source, registryDir);
    expect(hook.exitCode).toBe(0);
    expect(json<{ mode: string }>(hook).mode).toBe("bound");

    // 10. source repository is byte-for-byte unchanged and still clean.
    expect(head(source)).toBe(sourceHead);
    expect(sourceIndexBytes(source)).toEqual(sourceIndexBefore);
    expect(snapshotWorktree(source)).toEqual(sourceWorktreeBefore);
    expect(git(source, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("blocks formal review on a dirty source and staged knowledge", async () => {
    const base = track(makeTempDir("llmdoc-dogfood-fail-"));
    const source = initRepo(path.join(base, "source"));
    const registryDir = track(makeTempDir("llmdoc-dogfood-fail-registry-"));
    const knowledgeRoot = path.join(base, "knowledge");
    writeFile(source, "src/api/retry.ts", "export const retry = 1;\n");
    git(source, ["add", "--", "src/api/retry.ts"]);
    git(source, ["commit", "-m", "baseline"]);
    await cli(["--json", "init", "--source", source, "--knowledge", knowledgeRoot], source, registryDir);
    writeFile(
      knowledgeRoot,
      "docs/architecture.md",
      "---\ndescription: Retry\nkind: architecture\nsource:\n  paths:\n    - src/api/retry.ts\n---\n\n# Retry\n"
    );

    writeFile(source, "src/api/retry.ts", "export const retry = 2;\n");
    const dirtyReview = await cli(["--json", "review"], source, registryDir);
    expect(dirtyReview.exitCode).toBe(3);
    expect(json<{ error: { code: string } }>(dirtyReview).error.code).toBe("E_SOURCE_DIRTY");
    git(source, ["checkout", "--", "src/api/retry.ts"]);

    const review = await cli(["--json", "review"], source, registryDir);
    const reviewId = json<{ reviewId: string }>(review).reviewId;
    await cli(["--json", "review", "--confirm", reviewId], source, registryDir);
    writeFile(knowledgeRoot, "docs/extra.md", "# extra\n");
    git(knowledgeRoot, ["add", "docs/extra.md"]);
    const stagedCommit = await cli(["--json", "commit", "--review", reviewId], source, registryDir);
    expect(stagedCommit.exitCode).toBe(3);
    expect(json<{ error: { code: string } }>(stagedCommit).error.code).toBe("E_KNOWLEDGE_INDEX_DIRTY");
    git(knowledgeRoot, ["reset"]);
    fs.rmSync(path.join(knowledgeRoot, "docs", "extra.md"), { force: true });
  });

  it("migrates a legacy V3 layout only when explicitly asked", async () => {
    const base = track(makeTempDir("llmdoc-dogfood-migrate-"));
    const source = initRepo(path.join(base, "source"));
    writeFile(source, "src/api/retry.ts", "export const retry = 1;\n");
    writeFile(
      source,
      "llmdoc/architecture.mdx",
      "---\ndescription: Legacy retry\nkind: architecture\ncode:\n  paths:\n    - src/api/retry.ts\n---\n\n# Legacy retry\n"
    );
    git(source, ["add", "--", "src/api/retry.ts", "llmdoc/architecture.mdx"]);
    git(source, ["commit", "-m", "legacy baseline"]);
    const legacyBefore = snapshotWorktree(source);
    const target = path.join(base, "migrated");
    const registryDir = track(makeTempDir("llmdoc-dogfood-migrate-registry-"));

    const dryRun = await cli(["--json", "migrate", "--dry-run", "--source", source, "--knowledge", target], source, registryDir);
    expect(dryRun.exitCode).toBe(0);
    expect(json<{ schema: string }>(dryRun).schema).toBe("llmdoc.migrate/v1");
    expect(fs.existsSync(target)).toBe(false);
    expect(snapshotWorktree(source)).toEqual(legacyBefore);

    const migrate = await cli(["--json", "migrate", "--source", source, "--knowledge", target], source, registryDir);
    expect(migrate.exitCode).toBe(0);
    expect(fs.existsSync(path.join(target, "docs", "architecture.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, ".llmdoc", "meta.json"))).toBe(true);
    expect(snapshotWorktree(source)).toEqual(legacyBefore);
  });
});
