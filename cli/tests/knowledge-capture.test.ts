import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 90000 });

import {
  advanceSource,
  createKnowledgeFixture,
  expectKnowledgeError,
  git,
  head,
  knowledgeDoc,
  makeTempDir,
  sourceIndexBytes,
  writeFile
} from "./knowledge-helpers.js";
import { captureCandidate, assertCapturePreconditions } from "../src/lib/knowledge/capture.js";
import { conditionalDelete, conditionalWrite } from "../src/lib/knowledge/transaction.js";
import { resolveKnowledgeWriteContext } from "../src/lib/knowledge/write-context.js";
import { loadKnowledgeForRead } from "../src/lib/knowledge/read.js";
import { listCommittedInboxIds, listWorktreeInboxIds } from "../src/lib/knowledge/inbox.js";

function worktreeStatus(root: string): string {
  return git(root, ["status", "--porcelain"]);
}

describe("knowledge capture", () => {
  test("commits only inbox and leaves docs, meta and the source server-side untouched", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const k0 = fixture.knowledgeHead;
    const metaBefore = fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8");
    const sourceIndexBefore = sourceIndexBytes(fixture.source);
    const sourceHeadBefore = head(fixture.source);

    const result = await captureCandidate({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      title: "Follow-up retry idea",
      note: "seen while reading retry.ts",
      body: "# Candidate\n\nConsider jittered backoff.\n"
    });

    expect(result.status).toBe("captured");
    expect(result.cleanupRequired).toBe(false);
    expect(result.sync.index).toBe("synced");
    expect(result.knowledgeBaseRevision).toBe(k0);
    expect(result.knowledgeRevision).not.toBe(k0);

    // K1 contains the candidate and nothing else changed.
    const tree = git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"]);
    expect(tree).toContain(`inbox/${result.candidateId}`);
    expect(tree).toContain("docs/api/retry.md");
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")).toBe(metaBefore);
    expect(git(fixture.knowledgeRoot, ["diff", "--name-only", k0, "HEAD"]).trim()).toBe(`inbox/${result.candidateId}`);

    // No verification trailer.
    const message = git(fixture.knowledgeRoot, ["log", "-1", "--format=%B"]);
    expect(message).toContain("llmdoc: capture candidate");
    expect(message).not.toContain("llmdoc-source-revision:");
    expect(message).not.toContain("llmdoc-verified-scope:");
    expect(message).not.toContain("llmdoc-review-id:");

    // Formal retrieval does not return candidates.
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.model.documents.some((document) => document.id.includes("inbox"))).toBe(false);
    expect(loaded.model.documents.some((document) => document.id === "api/retry.md")).toBe(true);

    // Source bytes and HEAD are unchanged; the knowledge worktree is clean.
    expect(sourceIndexBytes(fixture.source).equals(sourceIndexBefore)).toBe(true);
    expect(head(fixture.source)).toBe(sourceHeadBefore);
    expect(worktreeStatus(fixture.knowledgeRoot)).toBe("");
    expect(listWorktreeInboxIds(fixture.knowledgeRoot)).toContain(result.candidateId);
    expect(await listCommittedInboxIds(await contextFor(fixture))).toContain(result.candidateId);
  });

  test("commits only inbox while a docs draft stays dirty on disk", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-draft-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/api/retry.md", `${knowledgeDoc("guide", "Retry policy changed", { paths: ["src/api/retry.ts"] })}`);

    const result = await captureCandidate({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      title: "draft-time candidate",
      body: "body\n"
    });
    expect(result.cleanupRequired).toBe(false);
    const status = worktreeStatus(fixture.knowledgeRoot);
    expect(status).toContain(" M docs/api/retry.md");
    // The committed candidate is clean (index synced); the docs draft remains the only dirty path.
    expect(status).not.toContain(result.candidateId);
    const tree = git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"]);
    expect(git(fixture.knowledgeRoot, ["show", "HEAD:docs/api/retry.md"]).includes("Retry policy changed")).toBe(false);
    expect(tree).toContain(`inbox/${result.candidateId}`);
  });

  test("refuses any staged knowledge content and does not overwrite it", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-staged-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/api/retry.md", knowledgeDoc("guide", "Staged edit", { paths: ["src/api/retry.ts"] }));
    git(fixture.knowledgeRoot, ["add", "docs/api/retry.md"]);
    const k0 = head(fixture.knowledgeRoot);

    await expectKnowledgeError(
      () => captureCandidate({ sourceInput: fixture.source, registryDir: fixture.registryDir, title: "x", body: "y" }),
      "E_KNOWLEDGE_INDEX_DIRTY",
      3
    );
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(git(fixture.knowledgeRoot, ["diff", "--cached", "--name-only"]).trim()).toBe("docs/api/retry.md");
  });

  test("does not overwrite a concurrent git add that lands before index.lock", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-race-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/api/retry.md", knowledgeDoc("guide", "Concurrent edit", { paths: ["src/api/retry.ts"] }));
    const k0 = head(fixture.knowledgeRoot);

    await expectKnowledgeError(
      () =>
        captureCandidate({
          sourceInput: fixture.source,
          registryDir: fixture.registryDir,
          title: "race",
          body: "body\n",
          testHooks: {
            beforeIndexLock: () => {
              git(fixture.knowledgeRoot, ["add", "docs/api/retry.md"]);
            }
          }
        }),
      "E_KNOWLEDGE_INDEX_DIRTY",
      3
    );
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(git(fixture.knowledgeRoot, ["diff", "--cached", "--name-only"]).trim()).toBe("docs/api/retry.md");
  });

  test("reports a published K1 plus cleanup_required when post-publish work fails", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-cleanup-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const result = await captureCandidate({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      title: "cleanup",
      body: "body\n",
      testHooks: {
        afterPublish: () => {
          throw new Error("injected cleanup failure");
        }
      }
    });
    expect(result.cleanupRequired).toBe(true);
    expect(git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"])).toContain(`inbox/${result.candidateId}`);
    expect(result.knowledgeRevision).toBe(head(fixture.knowledgeRoot));
  });

  test("preserves out-of-scope drafts (meta and README) and never overwrites them", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-drafts-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, ".llmdoc/meta.json", "{\n  \"schema\": \"llmdoc.meta/v3-ng\", \"source\": {\"repositoryId\": \"x\", \"lastGlobalReviewRevision\": null}, \"documents\": {}}\n");
    writeFile(fixture.knowledgeRoot, "README.md", "# Human README\n\nhuman bytes\n");
    const metaDraft = fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8");

    const result = await captureCandidate({ sourceInput: fixture.source, registryDir: fixture.registryDir, title: "keep drafts", body: "b\n" });
    expect(result.cleanupRequired).toBe(false);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")).toBe(metaDraft);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "README.md"), "utf8")).toContain("human bytes");
  });

  test("requires an explicit binding and a valid independent knowledge branch", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-unbound-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const unboundSource = path.join(fixture.base, "unbound-source");
    fs.mkdirSync(unboundSource, { recursive: true });
    git(unboundSource, ["init"]);
    git(unboundSource, ["symbolic-ref", "HEAD", "refs/heads/main"]);

    await expectKnowledgeError(
      () => captureCandidate({ sourceInput: unboundSource, registryDir: fixture.registryDir, title: "x", body: "y" }),
      "E_BINDING_NOT_FOUND",
      2
    );
  });

  test("captures even when the source worktree is dirty", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-dirtysource-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.source, "src/api/retry.ts", "export const retry = 2;\n");
    const result = await captureCandidate({ sourceInput: fixture.source, registryDir: fixture.registryDir, title: "dirty", body: "b\n" });
    expect(result.status).toBe("captured");
    expect(result.sourceRevision).toBe(fixture.sourceHead);
  });

  test("assertCapturePreconditions is independent of source cleanliness", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-capture-preconds-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.source, "src/uncommitted.ts", "export const x = 1;\n");
    const context = await resolveKnowledgeWriteContext({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    await expect(assertCapturePreconditions(context)).resolves.toBeUndefined();
    await advanceSource(fixture.source, { "src/api/retry.ts": "export const retry = 3;\n" }, "advance");
    const fresh = await resolveKnowledgeWriteContext({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    await expect(assertCapturePreconditions(fresh)).resolves.toBeUndefined();
  });

  test("treats only ENOENT as an empty inbox and surfaces other readdir failures", async () => {
    const root = makeTempDir("llmdoc-inbox-io-");
    expect(listWorktreeInboxIds(root)).toEqual([]);
    fs.writeFileSync(path.join(root, "inbox"), "not a directory");
    await expectKnowledgeError(() => listWorktreeInboxIds(root), "E_FILESYSTEM_IO", 70);
  });

  test("conditionalWrite never overwrites a concurrently created or modified file", () => {
    const root = makeTempDir("llmdoc-condwrite-");
    const file = path.join(root, "meta.json");

    // Absent observation but the file already exists: atomic create refuses.
    fs.writeFileSync(file, "existing");
    expect(conditionalWrite(file, null, "new")).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("existing");

    // Existing replacement: a write between compare and replacement is detected.
    const observation = Buffer.from("v1");
    fs.writeFileSync(file, observation);
    const ok = conditionalWrite(file, observation, "v2", {
      afterCompare: () => fs.writeFileSync(file, "intruder")
    });
    expect(ok).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("intruder");

    // Normal replacement still succeeds.
    fs.writeFileSync(file, observation);
    expect(conditionalWrite(file, observation, "v2")).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("v2");
  });

  test("conditionalWrite removes its temp file when the atomic rename fails", () => {
    const root = makeTempDir("llmdoc-condwrite-rename-");
    const file = path.join(root, "meta.json");
    const observation = Buffer.from("v1");
    fs.writeFileSync(file, observation);

    const ok = conditionalWrite(file, observation, "v2", {
      beforeRename: () => {
        throw new Error("injected rename failure");
      }
    });

    expect(ok).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("v1");
    expect(fs.readdirSync(root).filter((name) => name.includes(".llmdoc-sync-"))).toEqual([]);
  });

  test("conditionalDelete only removes an observed-absent path and never a present one", () => {
    const root = makeTempDir("llmdoc-conddelete-");
    const file = path.join(root, "candidate.md");

    // observation=null and the path is absent: deletion succeeds.
    expect(conditionalDelete(file, null)).toBe(true);

    // observation=null but the path reappeared: preserve it and report unsynced.
    fs.writeFileSync(file, "recreated");
    expect(conditionalDelete(file, null)).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("recreated");

    // A non-null observation is unsupported and must never delete.
    expect(conditionalDelete(file, Buffer.from("recreated"))).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("recreated");
  });
});

async function contextFor(fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>) {
  return resolveKnowledgeWriteContext({ sourceInput: fixture.source, registryDir: fixture.registryDir });
}
