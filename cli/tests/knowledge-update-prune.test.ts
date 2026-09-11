import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 90000 });

import { createKnowledgeFixture, expectKnowledgeError, git, head, knowledgeDoc, writeFile } from "./knowledge-helpers.js";
import { captureCandidate } from "../src/lib/knowledge/capture.js";
import { runUpdateWorkflow } from "../src/lib/knowledge/update.js";
import { runReview } from "../src/commands/review.js";
import { runCommit } from "../src/commands/commit.js";
import { loadKnowledgeForRead } from "../src/lib/knowledge/read.js";
import { listWorktreeInboxIds } from "../src/lib/knowledge/inbox.js";

async function capture(fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>, title: string): Promise<string> {
  const result = await captureCandidate({
    sourceInput: fixture.source,
    registryDir: fixture.registryDir,
    title,
    body: `# ${title}\n\ndetails\n`
  });
  return result.candidateId;
}

async function confirmAndCommit(
  fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>,
  reviewId: string
): Promise<Record<string, unknown>> {
  const confirmed = await runReview({ cwd: fixture.source, source: fixture.source, registryDir: fixture.registryDir, confirm: reviewId });
  expect(confirmed.exitCode).toBe(0);
  const committed = await runCommit({ cwd: fixture.source, source: fixture.source, registryDir: fixture.registryDir, review: reviewId });
  expect(committed.exitCode).toBe(0);
  return committed.output as Record<string, unknown>;
}

function metaJson(root: string): string {
  return fs.readFileSync(path.join(root, ".llmdoc", "meta.json"), "utf8");
}

async function validityFor(fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>, id: string): Promise<string> {
  const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
  return loaded.validity.byId.get(id)?.status ?? "unverified";
}

/** Validity projected over the live worktree drafts, not the committed K0 snapshot. */
async function worktreeValidityFor(
  fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>,
  id: string
): Promise<string> {
  const { resolveKnowledgeWriteContext } = await import("../src/lib/knowledge/write-context.js");
  const { computeValidity } = await import("../src/lib/knowledge/validity.js");
  const context = await resolveKnowledgeWriteContext({ sourceInput: fixture.source, registryDir: fixture.registryDir });
  const projection = await computeValidity({
    model: context.worktreeModel,
    meta: context.worktree.meta,
    source: context.source,
    identityVerified: true,
    knowledgeRevision: context.knowledgeHead
  });
  return projection.byId.get(id)?.status ?? "unverified";
}

const DRAFT_CANDIDATE = ["---", 'title: "Draft candidate"', 'capturedAt: "2026-01-01T00:00:00.000Z"', "sourceRevision: null", 'note: ""', "---", "", "# Draft", ""].join("\n");

describe("knowledge prune", () => {
  test("reports eligible duplicates and conservatively keeps fragment-only candidates", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-prune-report-", { "src/a.ts": "export const a = 1;\n" }, [
      { id: "dup/a.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "dup/b.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "small/a.md", content: knowledgeDoc("guide", "Small alpha", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "small/b.md", content: knowledgeDoc("guide", "Small beta", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] }
    ]);
    const { runPruneWorkflow } = await import("../src/lib/knowledge/prune.js");
    const k0 = head(fixture.knowledgeRoot);
    const report = await runPruneWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, report: true });
    expect(report.status).toBe("reported");
    const byId = new Map(report.candidates.map((candidate) => [candidate.id, candidate]));
    // A stable canonical survivor is retained; only the other members are eligible.
    expect(byId.get("dup/a.md")?.eligible).toBe(false);
    expect(byId.get("dup/a.md")?.reasons.some((reason) => reason.includes("survivor"))).toBe(true);
    expect(byId.get("dup/b.md")?.eligible).toBe(true);
    expect(byId.get("small/a.md")?.eligible).toBe(false);
    expect(byId.get("small/a.md")?.reasons.some((reason) => reason.includes("fragment"))).toBe(true);
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(git(fixture.knowledgeRoot, ["status", "--porcelain"]).trim()).toBe("");
  });

  test("does not treat same-description documents with different content as duplicates", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-prune-contentkey-", { "src/a.ts": "export const a = 1;\n" }, [
      { id: "dup/a.md", content: knowledgeDoc("guide", "Shared description", { paths: ["src/a.ts"], body: "# Alpha\n" }), scope: ["src/a.ts"] },
      { id: "dup/b.md", content: knowledgeDoc("guide", "Shared description", { paths: ["src/a.ts"], body: "# Beta\n" }), scope: ["src/a.ts"] }
    ]);
    const { runPruneWorkflow } = await import("../src/lib/knowledge/prune.js");
    const report = await runPruneWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, report: true });
    for (const id of ["dup/a.md", "dup/b.md"]) {
      const candidate = report.candidates.find((entry) => entry.id === id);
      expect(candidate?.eligible).toBe(false);
      expect(candidate?.reasons.some((reason) => reason.includes("Exact duplicate"))).toBe(false);
    }
  });

  test("refuses to remove an entire exact-duplicate group", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-prune-group-", { "src/a.ts": "export const a = 1;\n" }, [
      { id: "dup/a.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "dup/b.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] }
    ]);
    const { runPruneWorkflow } = await import("../src/lib/knowledge/prune.js");
    const k0 = head(fixture.knowledgeRoot);
    await expectKnowledgeError(
      () => runPruneWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, remove: ["dup/a.md", "dup/b.md"] }),
      "E_PRUNE_INSUFFICIENT",
      2
    );
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(fs.existsSync(path.join(fixture.knowledgeRoot, "docs", "dup", "a.md"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.knowledgeRoot, "docs", "dup", "b.md"))).toBe(true);
  });

  test("removes an eligible document and repairs every inbound relation and body link", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-prune-remove-", { "src/a.ts": "export const a = 1;\n" }, [
      { id: "dup/a.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "dup/b.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      {
        id: "dup/consumer.md",
        content: knowledgeDoc("reference", "Consumer", { paths: ["src/a.ts"], requires: ["dup/b.md"], body: "# Consumer\n\nSee [b](b.md).\n" }),
        scope: ["src/a.ts"],
        requires: ["dup/b.md"]
      }
    ]);
    const { runPruneWorkflow } = await import("../src/lib/knowledge/prune.js");
    const prepared = await runPruneWorkflow({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      remove: ["dup/b.md"]
    });
    expect(prepared.status).toBe("prepared");
    expect(prepared.writeSet?.deletions).toContain("dup/b.md");
    expect(prepared.repairedDocuments).toContain("dup/consumer.md");

    await confirmAndCommit(fixture, prepared.reviewId!);
    const tree = git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"]);
    expect(tree).not.toContain("docs/dup/b.md");
    expect(tree).toContain("docs/dup/a.md");

    const consumer = fs.readFileSync(path.join(fixture.knowledgeRoot, "docs", "dup", "consumer.md"), "utf8");
    expect(consumer).not.toContain("dup/b.md");
    expect(consumer).not.toContain("requires");
    expect(consumer).toContain("See b.");

    const meta = JSON.parse(metaJson(fixture.knowledgeRoot)) as { documents: Record<string, unknown> };
    expect(meta.documents["dup/b.md"]).toBeUndefined();
    expect(await validityFor(fixture, "dup/consumer.md")).toBe("current");
    expect(git(fixture.knowledgeRoot, ["status", "--porcelain"]).trim()).toBe("");
  });

  test("refuses to remove an insufficient candidate", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-prune-insufficient-", { "src/a.ts": "export const a = 1;\n" }, [
      { id: "small/a.md", content: knowledgeDoc("guide", "Small alpha", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "small/b.md", content: knowledgeDoc("guide", "Small beta", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] }
    ]);
    const { runPruneWorkflow } = await import("../src/lib/knowledge/prune.js");
    const k0 = head(fixture.knowledgeRoot);
    await expectKnowledgeError(
      () => runPruneWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, remove: ["small/a.md"] }),
      "E_PRUNE_INSUFFICIENT",
      2
    );
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(fs.existsSync(path.join(fixture.knowledgeRoot, "docs", "small", "a.md"))).toBe(true);
  });

  test("refuses to delete an eligible document that has an uncommitted rewrite", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-prune-draft-", { "src/a.ts": "export const a = 1;\n" }, [
      { id: "dup/a.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "dup/b.md", content: knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] }
    ]);
    // Same topic/kind/description (still eligible) but rewritten bytes: a human draft.
    writeFile(fixture.knowledgeRoot, "docs/dup/a.md", knowledgeDoc("guide", "Duplicate spec", { paths: ["src/a.ts"], body: "# rewritten\n" }));
    const k0 = head(fixture.knowledgeRoot);
    const draftBytes = fs.readFileSync(path.join(fixture.knowledgeRoot, "docs", "dup", "a.md"), "utf8");
    const indexBefore = fs.readFileSync(path.join(fixture.knowledgeRoot, ".git", "index"));

    const { runPruneWorkflow } = await import("../src/lib/knowledge/prune.js");
    await expectKnowledgeError(
      () => runPruneWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, remove: ["dup/a.md"] }),
      "E_PRUNE_INSUFFICIENT",
      2
    );

    // HEAD, index and the human draft are all preserved.
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "docs", "dup", "a.md"), "utf8")).toBe(draftBytes);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, ".git", "index")).equals(indexBefore)).toBe(true);
  });
});

describe("knowledge update orchestration", () => {
  test("reports committed inbox candidates without writing anything", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-report-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const candidateId = await capture(fixture, "Reported candidate");
    const k0 = head(fixture.knowledgeRoot);

    const result = await runUpdateWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(result.status).toBe("reported");
    expect(result.reviewId).toBeNull();
    expect(result.candidates.map((candidate) => candidate.id)).toContain(candidateId);
    expect(result.candidates.find((candidate) => candidate.id === candidateId)?.committed).toBe(true);
    expect(head(fixture.knowledgeRoot)).toBe(k0);
  });

  test("promotes a candidate: docs + meta + relations + candidate removal land in one K1", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-promote-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const candidateId = await capture(fixture, "Jittered backoff");

    const update = await runUpdateWorkflow({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      promote: {
        candidate: candidateId,
        to: "api/jittered-backoff.md",
        kind: "decision",
        description: "Why jittered backoff is used for retries",
        sourcePaths: ["src/api/retry.ts"],
        requires: ["api/retry.md"]
      }
    });
    expect(update.status).toBe("prepared");
    expect(update.reviewId).toBeTruthy();
    expect(update.writeSet?.documents).toEqual(["api/jittered-backoff.md"]);
    expect(update.writeSet?.candidates).toEqual([candidateId]);

    const result = await confirmAndCommit(fixture, update.reviewId!);
    expect(result.removedCandidates).toEqual([candidateId]);

    const tree = git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"]);
    expect(tree).toContain("docs/api/jittered-backoff.md");
    expect(tree).not.toContain(`inbox/${candidateId}`);
    expect(git(fixture.knowledgeRoot, ["status", "--porcelain"]).trim()).toBe("");

    // meta evidence was written in the same commit and the promoted document is current.
    const meta = JSON.parse(metaJson(fixture.knowledgeRoot)) as { documents: Record<string, { validatedContentDigest: string; validatedSourceRevision: string }> };
    expect(meta.documents["api/jittered-backoff.md"]).toBeTruthy();
    expect(meta.documents["api/jittered-backoff.md"]!.validatedSourceRevision).toBe(fixture.sourceHead);
    expect(await validityFor(fixture, "api/jittered-backoff.md")).toBe("current");
    expect(await validityFor(fixture, "api/retry.md")).toBe("current");

    // No candidate remains committed or in the worktree.
    expect(listWorktreeInboxIds(fixture.knowledgeRoot)).not.toContain(candidateId);
  });

  test("rejects a candidate with a candidate-only commit that leaves meta unchanged", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-reject-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const candidateId = await capture(fixture, "Reject me");
    const metaBefore = metaJson(fixture.knowledgeRoot);

    const update = await runUpdateWorkflow({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      reject: [candidateId]
    });
    expect(update.writeSet?.candidates).toEqual([candidateId]);
    expect(update.writeSet?.documents).toEqual([]);

    const result = await confirmAndCommit(fixture, update.reviewId!);
    expect(result.removedCandidates).toEqual([candidateId]);
    expect(git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"])).not.toContain(`inbox/${candidateId}`);
    expect(metaJson(fixture.knowledgeRoot)).toBe(metaBefore);
  });

  test("a normal Markdown edit is needs_review and update --prepare does not commit or write evidence", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-edit-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const k0 = head(fixture.knowledgeRoot);
    const metaBefore = metaJson(fixture.knowledgeRoot);
    // Ordinary body edit (and a front matter description edit) with no review declaration.
    writeFile(fixture.knowledgeRoot, "docs/api/retry.md", knowledgeDoc("guide", "Edited retry policy", { paths: ["src/api/retry.ts"] }));

    const prepared = await runUpdateWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, prepare: true });
    expect(prepared.status).toBe("prepared");
    expect(prepared.reviewId).toBeTruthy();
    // The edit is only a candidate: it must be needs_review in the worktree projection,
    // the knowledge HEAD must not move, and no validation evidence may be written.
    expect(prepared.writeSet?.documents).toContain("api/retry.md");
    expect(await worktreeValidityFor(fixture, "api/retry.md")).toBe("needs_review");
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(metaJson(fixture.knowledgeRoot)).toBe(metaBefore);
    // The committed K0 document still has its original evidence; nothing auto-promoted.
    expect(await validityFor(fixture, "api/retry.md")).toBe("current");
  });

  test("blocks promote and reject of an uncommitted inbox draft", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-draft-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "inbox/draft.md", DRAFT_CANDIDATE);
    const k0 = head(fixture.knowledgeRoot);

    await expectKnowledgeError(
      () =>
        runUpdateWorkflow({
          sourceInput: fixture.source,
          registryDir: fixture.registryDir,
          promote: {
            candidate: "draft.md",
            to: "api/draft.md",
            kind: "guide",
            description: "Draft",
            sourcePaths: ["src/api/retry.ts"]
          }
        }),
      "E_CANDIDATE_UNCOMMITTED",
      2
    );
    await expectKnowledgeError(
      () => runUpdateWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, reject: ["draft.md"] }),
      "E_CANDIDATE_UNCOMMITTED",
      2
    );

    // The draft is untouched and no commit happened.
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "inbox", "draft.md"), "utf8")).toBe(DRAFT_CANDIDATE);
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(fs.existsSync(path.join(fixture.knowledgeRoot, "docs", "api", "draft.md"))).toBe(false);
  });

  test("rejects invalid promotion requests", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-invalid-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const candidateId = await capture(fixture, "Invalid promote");
    await expectKnowledgeError(
      () =>
        runUpdateWorkflow({
          sourceInput: fixture.source,
          registryDir: fixture.registryDir,
          promote: { candidate: candidateId, to: "api/missing.md", kind: "bogus", description: "x", sourcePaths: ["src/api/retry.ts"] }
        }),
      "E_INVALID_KIND",
      2
    );
    await expectKnowledgeError(
      () => runUpdateWorkflow({ sourceInput: fixture.source, registryDir: fixture.registryDir, reject: ["../escape.md"] }),
      "E_DOCUMENT_INVALID",
      2
    );
  });

  test("refuses to promote onto an existing document and preserves its bytes", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-exists-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const candidateId = await capture(fixture, "Overwrite attempt");
    const existingPath = path.join(fixture.knowledgeRoot, "docs", "api", "retry.md");
    const before = fs.readFileSync(existingPath, "utf8");
    const k0 = head(fixture.knowledgeRoot);

    await expectKnowledgeError(
      () =>
        runUpdateWorkflow({
          sourceInput: fixture.source,
          registryDir: fixture.registryDir,
          promote: { candidate: candidateId, to: "api/retry.md", kind: "guide", description: "Replacement", sourcePaths: ["src/api/retry.ts"] }
        }),
      "E_DOCUMENT_EXISTS",
      2
    );
    expect(fs.readFileSync(existingPath, "utf8")).toBe(before);
    expect(listWorktreeInboxIds(fixture.knowledgeRoot)).toContain(candidateId);
    expect(head(fixture.knowledgeRoot)).toBe(k0);
  });

  test("rejects a promotion with an invalid relation before writing any bytes", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-badrel-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const candidateId = await capture(fixture, "Bad relation");
    const k0 = head(fixture.knowledgeRoot);
    const metaBefore = metaJson(fixture.knowledgeRoot);
    const indexBefore = fs.readFileSync(path.join(fixture.knowledgeRoot, ".git", "index"));

    await expectKnowledgeError(
      () =>
        runUpdateWorkflow({
          sourceInput: fixture.source,
          registryDir: fixture.registryDir,
          promote: {
            candidate: candidateId,
            to: "api/bad.md",
            kind: "guide",
            description: "Bad",
            sourcePaths: ["src/api/retry.ts"],
            requires: ["missing.md"]
          }
        }),
      "E_STRUCTURE_INVALID",
      2
    );

    expect(fs.existsSync(path.join(fixture.knowledgeRoot, "docs", "api", "bad.md"))).toBe(false);
    expect(listWorktreeInboxIds(fixture.knowledgeRoot)).toContain(candidateId);
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(metaJson(fixture.knowledgeRoot)).toBe(metaBefore);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, ".git", "index")).equals(indexBefore)).toBe(true);
  });

  test("rolls back worktree mutations when a later update step fails", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-update-rollback-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const candidateId = await capture(fixture, "Rollback candidate");
    const k0 = head(fixture.knowledgeRoot);
    const metaBefore = metaJson(fixture.knowledgeRoot);
    const indexBefore = fs.readFileSync(path.join(fixture.knowledgeRoot, ".git", "index"));
    const candidateRaw = fs.readFileSync(path.join(fixture.knowledgeRoot, "inbox", candidateId), "utf8");

    await expect(
      runUpdateWorkflow({
        sourceInput: fixture.source,
        registryDir: fixture.registryDir,
        promote: { candidate: candidateId, to: "api/new.md", kind: "guide", description: "New", sourcePaths: ["src/api/retry.ts"] },
        testHooks: {
          afterApply: () => {
            throw new Error("injected post-apply failure");
          }
        }
      })
    ).rejects.toThrow("injected post-apply failure");

    expect(fs.existsSync(path.join(fixture.knowledgeRoot, "docs", "api", "new.md"))).toBe(false);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "inbox", candidateId), "utf8")).toBe(candidateRaw);
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(metaJson(fixture.knowledgeRoot)).toBe(metaBefore);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, ".git", "index")).equals(indexBefore)).toBe(true);
  });
});
