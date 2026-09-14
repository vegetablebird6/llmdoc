import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import { contentDigest } from "../src/lib/knowledge/document.js";
import { buildKnowledgeModel } from "../src/lib/knowledge/knowledge-model.js";
import { renderNavigation, replaceNavigationRegion } from "../src/lib/knowledge/navigation.js";
import {
  buildReviewManifest,
  confirmReviewManifest,
  loadReviewManifest,
  reviewFilePath,
  writeReviewManifest,
  type ReviewConclusion,
  type ReviewManifest
} from "../src/lib/knowledge/review.js";
import { sealKnowledgeReview, type SealTestHooks } from "../src/lib/knowledge/seal.js";
import { resolveKnowledgeWriteContext } from "../src/lib/knowledge/write-context.js";
import { runReview } from "../src/commands/review.js";
import {
  advanceSource,
  createKnowledgeFixture,
  expectKnowledgeError,
  git,
  head,
  knowledgeDoc,
  realPath,
  snapshotWorktree,
  sourceIndexBytes,
  writeFile,
  type KnowledgeFixture
} from "./knowledge-helpers.js";

const createdDirs: string[] = [];

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort
    }
  }
});

function fixtureOptions(fixture: KnowledgeFixture) {
  return { sourceInput: fixture.source, knowledgeInput: fixture.knowledgeRoot, registryDir: fixture.registryDir };
}

async function generate(fixture: KnowledgeFixture, options: { global?: boolean } = {}): Promise<ReviewManifest> {
  const context = await resolveKnowledgeWriteContext(fixtureOptions(fixture));
  const manifest = buildReviewManifest(context, options);
  writeReviewManifest(fixture.knowledgeRoot, manifest);
  return manifest;
}

async function confirm(
  fixture: KnowledgeFixture,
  manifest: ReviewManifest,
  overrides?: Record<string, ReviewConclusion>
): Promise<ReviewManifest> {
  const context = await resolveKnowledgeWriteContext(fixtureOptions(fixture));
  const confirmed = confirmReviewManifest(context, loadReviewManifest(fixture.knowledgeRoot, manifest.reviewId), { overrides });
  writeReviewManifest(fixture.knowledgeRoot, confirmed);
  return confirmed;
}

function seal(fixture: KnowledgeFixture, reviewId: string, testHooks?: SealTestHooks) {
  return sealKnowledgeReview({ ...fixtureOptions(fixture), reviewId, testHooks });
}

async function makeFixture(prefix: string, docs: Parameters<typeof createKnowledgeFixture>[2]) {
  const fixture = await createKnowledgeFixture(
    prefix,
    { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n", "pkg/lease/x.ts": "export const x = 1;\n" },
    docs
  );
  createdDirs.push(fixture.base);
  return fixture;
}

const docA = (body = "# A\n") => knowledgeDoc("guide", "Document A", { paths: ["src/a.ts"], body });
const docB = (body = "# B\n") => knowledgeDoc("guide", "Document B", { paths: ["src/b.ts"], body });

describe("review manifest and seal transaction", () => {
  it("seals changed docs and meta in a single commit and leaves the worktree clean", async () => {
    const fixture = await makeFixture("llmdoc-seal-basic-", [
      { id: "a.md", content: docA(), scope: ["src/a.ts"] },
      { id: "b.md", content: docB(), scope: ["src/b.ts"] }
    ]);
    const nextA = docA("# A\n\nupdated\n");
    writeFile(fixture.knowledgeRoot, "docs/a.md", nextA);

    const manifest = await generate(fixture);
    const itemA = manifest.documents.find((item) => item.id === "a.md");
    expect(itemA?.proposedConclusion).toBe("changed");
    await confirm(fixture, manifest);
    const result = await seal(fixture, manifest.reviewId);

    expect(result.status).toBe("success");
    expect(result.changedDocuments).toEqual(["a.md"]);
    expect(result.metaOnly).toBe(false);
    expect(head(fixture.knowledgeRoot)).toBe(result.knowledgeRevision);
    const lineage = git(fixture.knowledgeRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
    expect(lineage).toEqual([result.knowledgeRevision, fixture.knowledgeHead]);
    const committed = git(fixture.knowledgeRoot, ["show", "--pretty=", "--name-only", "HEAD"])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
    expect(committed).toEqual([".llmdoc/meta.json", "README.md", "docs/a.md"]);

    const meta = JSON.parse(fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")) as {
      documents: Record<string, { validatedContentDigest: string; validatedSourceRevision: string }>;
    };
    expect(meta.documents["a.md"]!.validatedContentDigest).toBe(contentDigest(nextA));
    expect(meta.documents["a.md"]!.validatedSourceRevision).toBe(fixture.sourceHead);
    expect(git(fixture.knowledgeRoot, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("advances a meta-only commit when the body is unchanged but the source scope moved", async () => {
    const fixture = await makeFixture("llmdoc-seal-metaonly-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const nextSourceHead = advanceSource(fixture.source, { "src/a.ts": "export const a = 2;\n" }, "source advance");

    const manifest = await generate(fixture);
    expect(manifest.documents.map((item) => item.id)).toEqual(["a.md"]);
    expect(manifest.documents[0]!.proposedConclusion).toBe("unchanged");
    await confirm(fixture, manifest);
    const result = await seal(fixture, manifest.reviewId);

    expect(result.metaOnly).toBe(true);
    expect(result.changedDocuments).toEqual([]);
    expect(result.refreshedDocuments).toEqual(["a.md"]);
    const committed = git(fixture.knowledgeRoot, ["show", "--pretty=", "--name-only", "HEAD"]).trim();
    expect(committed).toBe(".llmdoc/meta.json");
    const meta = JSON.parse(fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")) as {
      documents: Record<string, { validatedSourceRevision: string }>;
    };
    expect(meta.documents["a.md"]!.validatedSourceRevision).toBe(nextSourceHead);
  });

  it("refuses to seal an unconfirmed manifest", async () => {
    const fixture = await makeFixture("llmdoc-seal-unconfirmed-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_REVIEW_NOT_CONFIRMED", 3);
    expect(head(fixture.knowledgeRoot)).toBe(fixture.knowledgeHead);
  });

  it("invalidates the manifest when content, scope or deletion drifts after confirmation", async () => {
    const fixture = await makeFixture("llmdoc-seal-drift-", [
      { id: "a.md", content: docA(), scope: ["src/a.ts"] },
      { id: "b.md", content: docB(), scope: ["src/b.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);

    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged twice\n"));
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_REVIEW_INVALIDATED", 3);

    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    writeFile(
      fixture.knowledgeRoot,
      "docs/b.md",
      knowledgeDoc("guide", "Document B", { paths: ["src/b.ts", "src/a.ts"], body: "# B\n" })
    );
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_REVIEW_INVALIDATED", 3);
    expect(head(fixture.knowledgeRoot)).toBe(fixture.knowledgeHead);
  });

  it("uses the union of old and new scope so a narrowed scope still triggers review", async () => {
    const fixture = await makeFixture("llmdoc-seal-scope-", [
      { id: "a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts", "pkg/lease/**"], body: "# A\n" }), scope: ["pkg/lease/**", "src/a.ts"] }
    ]);
    advanceSource(fixture.source, { "pkg/lease/x.ts": "export const x = 2;\n" }, "lease change");
    writeFile(fixture.knowledgeRoot, "docs/a.md", knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n" }));

    const manifest = await generate(fixture);
    const item = manifest.documents.find((candidate) => candidate.id === "a.md");
    expect(item?.removedScope).toContain("pkg/lease/**");
    expect(item?.reasons.some((reason) => reason.includes("pkg/lease"))).toBe(true);
  });

  it("binds same-batch requires to the final digest and never auto-refreshes a dependent", async () => {
    const b1 = docB();
    const a1 = knowledgeDoc("guide", "Document A", { paths: ["src/a.ts"], requires: ["b.md"], body: "# A\n" });
    const fixture = await makeFixture("llmdoc-seal-requires-", [
      { id: "a.md", content: a1, scope: ["src/a.ts"], requires: ["b.md"] },
      { id: "b.md", content: b1, scope: ["src/b.ts"] }
    ]);
    const b2 = docB("# B\n\nv2\n");
    const a2 = knowledgeDoc("guide", "Document A", { paths: ["src/a.ts"], requires: ["b.md"], body: "# A\n\nv2\n" });
    writeFile(fixture.knowledgeRoot, "docs/a.md", a2);
    writeFile(fixture.knowledgeRoot, "docs/b.md", b2);

    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    const result = await seal(fixture, manifest.reviewId);
    expect(result.changedDocuments.sort()).toEqual(["a.md", "b.md"]);
    const meta = JSON.parse(fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")) as {
      documents: Record<string, { validatedRequires: Record<string, string> }>;
    };
    expect(meta.documents["a.md"]!.validatedRequires["b.md"]).toBe(contentDigest(b2));

    const b3 = docB("# B\n\nv3\n");
    writeFile(fixture.knowledgeRoot, "docs/b.md", b3);
    const second = await generate(fixture);
    expect(second.documents.find((item) => item.id === "a.md")?.action).toBe("refresh");
    await confirm(fixture, second, { "a.md": "insufficient" });
    const secondResult = await seal(fixture, second.reviewId);
    expect(secondResult.changedDocuments).toEqual(["b.md"]);

    const context = await resolveKnowledgeWriteContext(fixtureOptions(fixture));
    const aValidity = context.validity.byId.get("a.md");
    expect(aValidity?.status).toBe("needs_review");
    expect(aValidity?.reasons.some((reason) => reason.includes("requires target digest changed"))).toBe(true);
  });

  it("preserves an out-of-scope draft while sealing the reviewed write set", async () => {
    const fixture = await makeFixture("llmdoc-seal-draft-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    writeFile(fixture.knowledgeRoot, "docs/draft.md", knowledgeDoc("guide", "Draft", { paths: ["src/a.ts"], body: "# Draft\n" }));

    const manifest = await generate(fixture);
    expect(manifest.documents.map((item) => item.id).sort()).toEqual(["a.md", "draft.md"]);
    await confirm(fixture, manifest, { "draft.md": "insufficient" });
    const result = await seal(fixture, manifest.reviewId);

    expect(result.changedDocuments).toEqual(["a.md"]);
    expect(fs.existsSync(path.join(fixture.knowledgeRoot, "docs", "draft.md"))).toBe(true);
    const status = git(fixture.knowledgeRoot, ["status", "--porcelain"]).trim();
    expect(status).toContain("?? docs/draft.md");
  });

  it("rejects a manifest that was already consumed", async () => {
    const fixture = await makeFixture("llmdoc-seal-dup-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    await seal(fixture, manifest.reviewId);
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_REVIEW_INVALIDATED", 3);
  });

  it("rejects any staged knowledge content", async () => {
    const fixture = await makeFixture("llmdoc-seal-staged-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    git(fixture.knowledgeRoot, ["add", "docs/a.md"]);
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_KNOWLEDGE_INDEX_DIRTY", 3);
    git(fixture.knowledgeRoot, ["reset", "--", "docs/a.md"]);
  });

  it("blocks dirty, untracked, conflicting or drifted source snapshots before publishing", async () => {
    const fixture = await makeFixture("llmdoc-seal-source-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);

    writeFile(fixture.source, "src/a.ts", "export const a = 999;\n");
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_SOURCE_DIRTY", 3);

    writeFile(fixture.source, "src/a.ts", "export const a = 1;\n");
    writeFile(fixture.source, "src/untracked.ts", "export const u = 1;\n");
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_SOURCE_DIRTY", 3);
    fs.rmSync(path.join(fixture.source, "src", "untracked.ts"));

    writeFile(fixture.source, "src/a.ts", "export const a = 999;\n");
    git(fixture.source, ["add", "src/a.ts"]);
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_SOURCE_DIRTY", 3);
    git(fixture.source, ["reset", "--", "src/a.ts"]);
    writeFile(fixture.source, "src/a.ts", "export const a = 1;\n");

    advanceSource(fixture.source, { "src/a.ts": "export const a = 2;\n" }, "source drift");
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_SOURCE_HEAD_DRIFT", 3);
    expect(head(fixture.knowledgeRoot)).toBe(fixture.knowledgeHead);
  });

  it("blocks detached HEAD and in-progress merge states", async () => {
    const fixture = await makeFixture("llmdoc-seal-opstate-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);

    git(fixture.knowledgeRoot, ["checkout", "--detach"]);
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_KNOWLEDGE_NOT_ON_BRANCH", 3);
    git(fixture.knowledgeRoot, ["checkout", "main"]);

    fs.writeFileSync(path.join(fixture.knowledgeRoot, ".git", "MERGE_HEAD"), `${fixture.knowledgeHead}\n`);
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_KNOWLEDGE_NOT_ON_BRANCH", 3);
    fs.rmSync(path.join(fixture.knowledgeRoot, ".git", "MERGE_HEAD"));
  });

  it("fails the publish CAS without moving the branch when it races", async () => {
    const fixture = await makeFixture("llmdoc-seal-cas-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);

    await expectKnowledgeError(
      () =>
        seal(fixture, manifest.reviewId, {
          beforeCas: () => {
            const tree = git(fixture.knowledgeRoot, ["rev-parse", "HEAD^{tree}"]).trim();
            const external = spawnSync(
              "git",
              ["-c", "user.email=test@example.com", "-c", "user.name=Test User", "-c", "commit.gpgsign=false", "commit-tree", tree, "-p", fixture.knowledgeHead, "-m", "external"],
              { cwd: fixture.knowledgeRoot, encoding: "utf8" }
            ).stdout.trim();
            git(fixture.knowledgeRoot, ["update-ref", "refs/heads/main", external, fixture.knowledgeHead]);
          }
        }),
      "E_CAS_CONFLICT",
      70
    );
    expect(head(fixture.knowledgeRoot)).not.toBe(fixture.knowledgeHead);
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_KNOWLEDGE_HEAD_MISMATCH", 3);
  });

  it("reports a published K1 plus cleanup_required when post-publish cleanup fails", async () => {
    const fixture = await makeFixture("llmdoc-seal-cleanup-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);

    const result = await seal(fixture, manifest.reviewId, {
      afterPublish: () => {
        throw new Error("injected post-publish failure");
      }
    });
    expect(result.status).toBe("success");
    expect(result.cleanupRequired).toBe(true);
    expect(head(fixture.knowledgeRoot)).toBe(result.knowledgeRevision);
    expect(result.sync.errors.length).toBeGreaterThan(0);
  });

  it("preserves an external meta edit observed after publication and reports it unsynced", async () => {
    const fixture = await makeFixture("llmdoc-seal-metasync-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);

    const metaPath = path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json");
    const external = "{ \"external\": true }\n";
    const result = await seal(fixture, manifest.reviewId, {
      afterPublish: () => {
        fs.writeFileSync(metaPath, external);
      }
    });
    expect(result.cleanupRequired).toBe(true);
    expect(result.sync.files.find((file) => file.path === ".llmdoc/meta.json")?.synced).toBe(false);
    expect(fs.readFileSync(metaPath, "utf8")).toBe(external);
  });

  it("never modifies the source repository and never runs Git hooks during sealing", async () => {
    const fixture = await makeFixture("llmdoc-seal-frozen-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nchanged\n"));

    const sentinel = path.join(fixture.knowledgeRoot, "hook-ran.txt");
    const hookDir = path.join(fixture.knowledgeRoot, ".git", "hooks");
    const hookBody = `#!/bin/sh\necho ran >> "${sentinel.replaceAll("\\", "/")}"\n`;
    for (const hookName of ["pre-commit", "reference-transaction", "post-commit"]) {
      const hookPath = path.join(hookDir, hookName);
      fs.writeFileSync(hookPath, hookBody);
      fs.chmodSync(hookPath, 0o755);
    }

    const sourceHeadBefore = head(fixture.source);
    const sourceIndexBefore = sourceIndexBytes(realPath(fixture.source));
    const sourceFilesBefore = snapshotWorktree(realPath(fixture.source));

    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    const result = await seal(fixture, manifest.reviewId);

    expect(result.status).toBe("success");
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(head(fixture.source)).toBe(sourceHeadBefore);
    expect(sourceIndexBytes(realPath(fixture.source)).equals(sourceIndexBefore)).toBe(true);
    expect(snapshotWorktree(realPath(fixture.source))).toEqual(sourceFilesBefore);
  });

  it("advances lastGlobalReviewRevision only through a global review scan", async () => {
    const fixture = await makeFixture("llmdoc-seal-global-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    advanceSource(fixture.source, { "src/a.ts": "export const a = 2;\n" }, "advance");
    const scopedManifest = await generate(fixture);
    await confirm(fixture, scopedManifest);
    const scoped = await seal(fixture, scopedManifest.reviewId);
    expect(scoped.lastGlobalReviewRevision).toBeNull();

    advanceSource(fixture.source, { "src/a.ts": "export const a = 3;\n" }, "advance again");
    const globalManifest = await generate(fixture, { global: true });
    await confirm(fixture, globalManifest);
    const global = await seal(fixture, globalManifest.reviewId);
    expect(global.lastGlobalReviewRevision).toBe(head(fixture.source));
  });

  it("physically updates a document even when the conclusion label is unchanged", async () => {
    const fixture = await makeFixture("llmdoc-seal-update-unchanged-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const nextA = docA("# A\n\nv2\n");
    writeFile(fixture.knowledgeRoot, "docs/a.md", nextA);
    const manifest = await generate(fixture);
    await confirm(fixture, manifest, { "a.md": "unchanged" });
    const result = await seal(fixture, manifest.reviewId);
    expect(result.status).toBe("success");
    expect(result.changedDocuments).toContain("a.md");
    expect(committedDigest(fixture, "a.md")).toBe(contentDigest(nextA));
    expect(metaOf(fixture).documents["a.md"]!.validatedContentDigest).toBe(contentDigest(nextA));
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "docs", "a.md"), "utf8")).toBe(nextA);
    expect(await validityStatus(fixture, "a.md")).toBe("current");
    expect(git(fixture.knowledgeRoot, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("physically adds a document even when the conclusion label is unchanged", async () => {
    const fixture = await makeFixture("llmdoc-seal-add-unchanged-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const newDoc = knowledgeDoc("guide", "New", { paths: ["src/a.ts"], body: "# New\n" });
    writeFile(fixture.knowledgeRoot, "docs/new.md", newDoc);
    const manifest = await generate(fixture);
    await confirm(fixture, manifest, { "new.md": "unchanged" });
    const result = await seal(fixture, manifest.reviewId);
    expect(result.changedDocuments).toContain("new.md");
    expect(committedDigest(fixture, "new.md")).toBe(contentDigest(newDoc));
    expect(metaOf(fixture).documents["new.md"]).toBeTruthy();
    expect(await validityStatus(fixture, "new.md")).toBe("current");
  });

  it("physically removes a deleted document even when the conclusion label is unchanged", async () => {
    const fixture = await makeFixture("llmdoc-seal-delete-unchanged-", [
      { id: "a.md", content: docA(), scope: ["src/a.ts"] },
      { id: "b.md", content: docB(), scope: ["src/b.ts"] }
    ]);
    fs.rmSync(path.join(fixture.knowledgeRoot, "docs", "a.md"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest, { "a.md": "unchanged" });
    const result = await seal(fixture, manifest.reviewId);
    expect(result.deletedDocuments).toContain("a.md");
    expect(committedExists(fixture, "a.md")).toBe(false);
    expect(metaOf(fixture).documents["a.md"]).toBeUndefined();
  });

  it("keeps a deleted document labelled insufficient out of the commit", async () => {
    const fixture = await makeFixture("llmdoc-seal-delete-insufficient-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    fs.rmSync(path.join(fixture.knowledgeRoot, "docs", "a.md"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest, { "a.md": "insufficient" });
    const result = await seal(fixture, manifest.reviewId);
    expect(result.status).toBe("no_change");
    expect(committedExists(fixture, "a.md")).toBe(true);
    expect(metaOf(fixture).documents["a.md"]).toBeTruthy();
  });

  it("aborts before CAS when the body lands after confirmation", async () => {
    const fixture = await makeFixture("llmdoc-seal-race-body-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nreviewed\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    await expectKnowledgeError(
      () =>
        seal(fixture, manifest.reviewId, {
          beforePublish: () => writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nraced\n"))
        }),
      "E_REVIEW_INVALIDATED",
      3
    );
    expect(head(fixture.knowledgeRoot)).toBe(fixture.knowledgeHead);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "docs", "a.md"), "utf8")).toContain("raced");
  });

  it("aborts before CAS when the front matter scope lands after confirmation", async () => {
    const fixture = await makeFixture("llmdoc-seal-race-scope-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nreviewed\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    await expectKnowledgeError(
      () =>
        seal(fixture, manifest.reviewId, {
          beforePublish: () =>
            writeFile(
              fixture.knowledgeRoot,
              "docs/a.md",
              knowledgeDoc("guide", "Document A", { paths: ["src/a.ts", "src/b.ts"], body: "# A\n\nreviewed\n" })
            )
        }),
      "E_REVIEW_INVALIDATED",
      3
    );
  });

  it("aborts before CAS when a deletion lands after confirmation", async () => {
    const fixture = await makeFixture("llmdoc-seal-race-delete-", [
      { id: "a.md", content: docA(), scope: ["src/a.ts"] },
      { id: "b.md", content: docB(), scope: ["src/b.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nreviewed\n"));
    writeFile(fixture.knowledgeRoot, "docs/b.md", docB("# B\n\nreviewed\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    await expectKnowledgeError(
      () =>
        seal(fixture, manifest.reviewId, {
          beforePublish: () => fs.rmSync(path.join(fixture.knowledgeRoot, "docs", "b.md"))
        }),
      "E_REVIEW_INVALIDATED",
      3
    );
  });

  it("aborts before CAS when an unreviewed addition lands after confirmation", async () => {
    const fixture = await makeFixture("llmdoc-seal-race-add-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nreviewed\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    await expectKnowledgeError(
      () =>
        seal(fixture, manifest.reviewId, {
          beforePublish: () =>
            writeFile(fixture.knowledgeRoot, "docs/race.md", knowledgeDoc("guide", "Race", { paths: ["src/a.ts"], body: "# Race\n" }))
        }),
      "E_REVIEW_INVALIDATED",
      3
    );
  });

  it("refuses to review or seal a structurally invalid worktree", async () => {
    const frontmatterFixture = await makeFixture("llmdoc-seal-struct-fm-", [
      { id: "bad-kind.md", content: knowledgeDoc("bogus", "Bad", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "escape.md", content: knowledgeDoc("guide", "Escape", { paths: ["../secret"] }), scope: ["../secret"] }
    ]);
    await expectStructureBlocked(frontmatterFixture);

    const relationsFixture = await makeFixture("llmdoc-seal-struct-rel-", [
      { id: "cyc-a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts"], requires: ["cyc-b.md"] }), scope: ["src/a.ts"], requires: ["cyc-b.md"] },
      { id: "cyc-b.md", content: knowledgeDoc("guide", "B", { paths: ["src/a.ts"], requires: ["cyc-a.md"] }), scope: ["src/a.ts"], requires: ["cyc-a.md"] },
      { id: "missing.md", content: knowledgeDoc("guide", "Missing", { paths: ["src/a.ts"], requires: ["nope.md"] }), scope: ["src/a.ts"], requires: ["nope.md"] }
    ]);
    await expectStructureBlocked(relationsFixture);

    const evidenceFixture = await makeFixture("llmdoc-seal-struct-evidence-", [
      { id: "literal.md", content: knowledgeDoc("guide", "Literal", { paths: ["src/nope.ts"] }), scope: ["src/nope.ts"] },
      { id: "glob.md", content: knowledgeDoc("guide", "Glob", { paths: ["src/*.tsx"] }), scope: ["src/*.tsx"] }
    ]);
    await expectStructureBlocked(evidenceFixture, false);
  });

  it("consumes a confirmed manifest even when there is nothing to publish", async () => {
    const fixture = await makeFixture("llmdoc-seal-noconsume-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const manifest = await generate(fixture);
    expect(manifest.writeSet.meta).toBe(false);
    await confirm(fixture, manifest);
    const first = await seal(fixture, manifest.reviewId);
    expect(first.status).toBe("no_change");
    await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_REVIEW_INVALIDATED", 3);
  });

  it("rejects an in-progress Git operation that appears before the final pre-CAS reload", async () => {
    const fixture = await makeFixture("llmdoc-seal-opstate-race-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nreviewed\n"));
    const manifest = await generate(fixture);
    await confirm(fixture, manifest);
    const mergeHead = path.join(fixture.knowledgeRoot, ".git", "MERGE_HEAD");
    try {
      await expectKnowledgeError(
        () =>
          seal(fixture, manifest.reviewId, {
            beforePublish: () => fs.writeFileSync(mergeHead, `${fixture.knowledgeHead}\n`)
          }),
        "E_KNOWLEDGE_NOT_ON_BRANCH",
        3
      );
      expect(head(fixture.knowledgeRoot)).toBe(fixture.knowledgeHead);
    } finally {
      fs.rmSync(mergeHead, { force: true });
    }
  });

  it("does not consume a no_change manifest when content, source or refs drift before consumption", async () => {
    const contentFixture = await makeFixture("llmdoc-seal-nocontent-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const contentManifest = await generate(contentFixture);
    expect(contentManifest.writeSet.meta).toBe(false);
    await confirm(contentFixture, contentManifest);
    await expectKnowledgeError(
      () =>
        seal(contentFixture, contentManifest.reviewId, {
          beforePublish: () =>
            writeFile(contentFixture.knowledgeRoot, "docs/race.md", knowledgeDoc("guide", "Race", { paths: ["src/a.ts"], body: "# Race\n" }))
        }),
      "E_REVIEW_INVALIDATED",
      3
    );
    expect(manifestConsumed(contentFixture, contentManifest.reviewId)).toBe(false);

    const sourceFixture = await makeFixture("llmdoc-seal-nosource-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const sourceManifest = await generate(sourceFixture);
    await confirm(sourceFixture, sourceManifest);
    await expectKnowledgeError(
      () =>
        seal(sourceFixture, sourceManifest.reviewId, {
          beforePublish: () => {
            advanceSource(sourceFixture.source, { "src/a.ts": "export const a = 2;\n" }, "race");
          }
        }),
      "E_SOURCE_HEAD_DRIFT",
      3
    );
    expect(manifestConsumed(sourceFixture, sourceManifest.reviewId)).toBe(false);

    const refFixture = await makeFixture("llmdoc-seal-noref-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const refManifest = await generate(refFixture);
    await confirm(refFixture, refManifest);
    await expectKnowledgeError(
      () =>
        seal(refFixture, refManifest.reviewId, {
          beforePublish: () => {
            const tree = git(refFixture.knowledgeRoot, ["rev-parse", "HEAD^{tree}"]).trim();
            const external = spawnSync(
              "git",
              ["-c", "user.email=test@example.com", "-c", "user.name=Test User", "-c", "commit.gpgsign=false", "commit-tree", tree, "-p", refFixture.knowledgeHead, "-m", "external"],
              { cwd: refFixture.knowledgeRoot, encoding: "utf8" }
            ).stdout.trim();
            git(refFixture.knowledgeRoot, ["update-ref", "refs/heads/main", external, refFixture.knowledgeHead]);
          }
        }),
      "E_KNOWLEDGE_HEAD_MISMATCH",
      3
    );
    expect(manifestConsumed(refFixture, refManifest.reviewId)).toBe(false);
  });

  it("does not consume a no_change manifest when another writer stages content before index.lock", async () => {
    const fixture = await makeFixture("llmdoc-seal-noindex-race-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const manifest = await generate(fixture);
    expect(manifest.writeSet.meta).toBe(false);
    await confirm(fixture, manifest);

    await expectKnowledgeError(
      () =>
        seal(fixture, manifest.reviewId, {
          beforeIndexLock: () => {
            writeFile(fixture.knowledgeRoot, "docs/a.md", docA("# A\n\nstaged race\n"));
            git(fixture.knowledgeRoot, ["add", "--", "docs/a.md"]);
          }
        }),
      "E_KNOWLEDGE_INDEX_DIRTY",
      3
    );

    expect(manifestConsumed(fixture, manifest.reviewId)).toBe(false);
    expect(head(fixture.knowledgeRoot)).toBe(fixture.knowledgeHead);
    expect(git(fixture.knowledgeRoot, ["diff", "--cached", "--name-only"]).trim()).toBe("docs/a.md");
  });

  it("reports cleanup_required when a removed candidate is recreated after the final verification", async () => {
    const fixture = await makeFixture("llmdoc-seal-candidate-race-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const { captureCandidate } = await import("../src/lib/knowledge/capture.js");
    const { runUpdateWorkflow } = await import("../src/lib/knowledge/update.js");
    const captured = await captureCandidate({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      title: "race candidate",
      body: "# candidate\n"
    });
    const candidateId = captured.candidateId;

    const update = await runUpdateWorkflow({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      reject: [candidateId]
    });
    expect(update.writeSet?.candidates).toEqual([candidateId]);
    await confirm(fixture, loadReviewManifest(fixture.knowledgeRoot, update.reviewId!));

    const candidatePath = path.join(fixture.knowledgeRoot, "inbox", candidateId);
    const recreated = '---\ntitle: "recreated draft"\n---\n\n# recreated\n';
    const result = await seal(fixture, update.reviewId!, {
      beforeCas: () => {
        fs.writeFileSync(candidatePath, recreated);
      }
    });

    // K1 removed the candidate, but the concurrent new draft is preserved and reported.
    expect(result.cleanupRequired).toBe(true);
    expect(fs.readFileSync(candidatePath, "utf8")).toBe(recreated);
    expect(git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"])).not.toContain(`inbox/${candidateId}`);
    expect(result.sync.errors.some((error) => error.includes(candidateId))).toBe(true);
  });

  it("keeps a dependent bound to K0 when its requires target is not advanced in the batch", async () => {
    const b0 = docB();
    const a0 = knowledgeDoc("guide", "Document A", { paths: ["src/a.ts"], requires: ["b.md"], body: "# A\n" });
    const fixture = await makeFixture("llmdoc-seal-requires-insufficient-", [
      { id: "a.md", content: a0, scope: ["src/a.ts"], requires: ["b.md"] },
      { id: "b.md", content: b0, scope: ["src/b.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/b.md", docB("# B\n\nv2\n"));

    const manifest = await generate(fixture);
    const aItem = manifest.documents.find((item) => item.id === "a.md");
    expect(aItem?.action).toBe("refresh");
    expect(aItem?.proposedConclusion).toBe("unchanged");
    const confirmed = await confirm(fixture, manifest, { "b.md": "insufficient" });
    expect(confirmed.documents.find((item) => item.id === "a.md")?.candidateRequires).toEqual([
      { id: "b.md", digest: contentDigest(b0) }
    ]);

    const result = await seal(fixture, manifest.reviewId);
    expect(result.status).toBe("success");
    expect(result.changedDocuments).toEqual([]);
    expect(result.refreshedDocuments).toEqual(["a.md"]);
    const meta = readMeta(fixture);
    expect(meta.documents["a.md"]!.validatedRequires["b.md"]).toBe(contentDigest(b0));
    expect(meta.documents["b.md"]!.validatedContentDigest).toBe(contentDigest(b0));
    // The unadvanced B draft remains an uncommitted worktree edit.
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "docs", "b.md"), "utf8")).toBe(docB("# B\n\nv2\n"));
  });

  it("binds a refreshed dependent to the accepted same-batch digest of its requires target", async () => {
    const a0 = knowledgeDoc("guide", "Document A", { paths: ["src/a.ts"], requires: ["b.md"], body: "# A\n" });
    const fixture = await makeFixture("llmdoc-seal-requires-accepted-", [
      { id: "a.md", content: a0, scope: ["src/a.ts"], requires: ["b.md"] },
      { id: "b.md", content: docB(), scope: ["src/b.ts"] }
    ]);
    const b1 = docB("# B\n\nv2\n");
    writeFile(fixture.knowledgeRoot, "docs/b.md", b1);

    const manifest = await generate(fixture);
    const confirmed = await confirm(fixture, manifest);
    expect(confirmed.documents.find((item) => item.id === "a.md")?.candidateRequires).toEqual([
      { id: "b.md", digest: contentDigest(b1) }
    ]);

    const result = await seal(fixture, manifest.reviewId);
    expect(result.changedDocuments).toEqual(["b.md"]);
    expect(result.refreshedDocuments).toEqual(["a.md"]);
    expect(readMeta(fixture).documents["a.md"]!.validatedRequires["b.md"]).toBe(contentDigest(b1));
  });

  it("rejects conclusions that would publish a structurally invalid mixed snapshot", async () => {
    const fixture = await makeFixture("llmdoc-confirm-projected-structure-", [
      { id: "a.md", content: docA(), scope: ["src/a.ts"] }
    ]);
    writeFile(
      fixture.knowledgeRoot,
      "docs/a.md",
      knowledgeDoc("guide", "Document A", { paths: ["src/a.ts"], requires: ["b.md"], body: "# A\n" })
    );
    writeFile(fixture.knowledgeRoot, "docs/b.md", docB());

    const manifest = await generate(fixture);
    expect(manifest.documents.find((item) => item.id === "a.md")?.action).toBe("update");
    expect(manifest.documents.find((item) => item.id === "b.md")?.action).toBe("add");
    await expectKnowledgeError(() => confirm(fixture, manifest, { "b.md": "insufficient" }), "E_STRUCTURE_INVALID", 2);
  });

  it("renders navigation from the projected K1 tree instead of the live worktree model", async () => {
    const fixture = await makeFixture("llmdoc-seal-projected-navigation-", [
      { id: "a.md", content: docA(), scope: ["src/a.ts"] }
    ]);
    writeFile(
      fixture.knowledgeRoot,
      "docs/a.md",
      knowledgeDoc("guide", "Document A updated", { paths: ["src/a.ts"], body: "# A\n\nv2\n" })
    );
    writeFile(fixture.knowledgeRoot, "docs/b.md", docB());

    const manifest = await generate(fixture);
    const confirmed = await confirm(fixture, manifest, { "b.md": "insufficient" });
    expect(confirmed.writeSet.generated).toEqual([".llmdoc/meta.json", "README.md"]);
    await seal(fixture, manifest.reviewId);

    const readme = fs.readFileSync(path.join(fixture.knowledgeRoot, "README.md"), "utf8");
    expect(readme).toContain("Document A updated");
    expect(readme).not.toContain("docs/b.md");
    expect(git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"])).not.toContain("docs/b.md");
  });

  it("invalidates at confirmation when content, candidate set, inbox or navigation drifted after generation", async () => {
    const bodyFixture = await makeFixture("llmdoc-confirm-drift-body-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(bodyFixture.knowledgeRoot, "docs/a.md", docA("# A\n\nv2\n"));
    const bodyManifest = await generate(bodyFixture);
    writeFile(bodyFixture.knowledgeRoot, "docs/a.md", docA("# A\n\nv3\n"));
    await expectKnowledgeError(() => confirm(bodyFixture, bodyManifest), "E_REVIEW_INVALIDATED", 3);

    const addFixture = await makeFixture("llmdoc-confirm-drift-add-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(addFixture.knowledgeRoot, "docs/a.md", docA("# A\n\nv2\n"));
    const addManifest = await generate(addFixture);
    writeFile(addFixture.knowledgeRoot, "docs/new.md", knowledgeDoc("guide", "New", { paths: ["src/a.ts"], body: "# New\n" }));
    await expectKnowledgeError(() => confirm(addFixture, addManifest), "E_REVIEW_INVALIDATED", 3);

    const deleteFixture = await makeFixture("llmdoc-confirm-drift-delete-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(deleteFixture.knowledgeRoot, "docs/a.md", docA("# A\n\nv2\n"));
    const deleteManifest = await generate(deleteFixture);
    fs.rmSync(path.join(deleteFixture.knowledgeRoot, "docs", "a.md"));
    await expectKnowledgeError(() => confirm(deleteFixture, deleteManifest), "E_REVIEW_INVALIDATED", 3);

    const inboxFixture = await makeFixture("llmdoc-confirm-drift-inbox-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const { captureCandidate } = await import("../src/lib/knowledge/capture.js");
    const captured = await captureCandidate({
      sourceInput: inboxFixture.source,
      registryDir: inboxFixture.registryDir,
      title: "inbox drift",
      body: "# candidate\n"
    });
    const inboxManifest = await generate(inboxFixture);
    expect(inboxManifest.writeSet.candidates).toEqual([]);
    fs.rmSync(path.join(inboxFixture.knowledgeRoot, "inbox", captured.candidateId));
    await expectKnowledgeError(() => confirm(inboxFixture, inboxManifest), "E_REVIEW_INVALIDATED", 3);

    const readmeFixture = await makeFixture("llmdoc-confirm-drift-readme-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    writeFile(readmeFixture.knowledgeRoot, "docs/a.md", docA("# A\n\nv2\n"));
    const readmeManifest = await generate(readmeFixture);
    expect(readmeManifest.writeSet.generated).toContain("README.md");
    const readmePath = path.join(readmeFixture.knowledgeRoot, "README.md");
    const existing = fs.readFileSync(readmePath, "utf8");
    const model = buildKnowledgeModel(path.join(readmeFixture.knowledgeRoot, "docs"));
    writeFile(readmeFixture.knowledgeRoot, "README.md", replaceNavigationRegion(existing, renderNavigation(model)).content);
    await expectKnowledgeError(() => confirm(readmeFixture, readmeManifest), "E_REVIEW_INVALIDATED", 3);
  });

  it("accepts reordered sets but rejects real member, digest or write set changes at confirmation", async () => {
    const docAWithRequires = (body: string, paths: string[]) =>
      knowledgeDoc("guide", "Document A", { paths, requires: ["b.md", "c.md"], body });
    const fixture = await makeFixture("llmdoc-confirm-reorder-", [
      {
        id: "a.md",
        content: docAWithRequires("# A\n", ["src/a.ts", "src/b.ts"]),
        scope: ["src/a.ts", "src/b.ts"],
        requires: ["b.md", "c.md"]
      },
      { id: "b.md", content: docB(), scope: ["src/b.ts"] },
      { id: "c.md", content: knowledgeDoc("guide", "Document C", { paths: ["pkg/lease/x.ts"], body: "# C\n" }), scope: ["pkg/lease/x.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/a.md", docAWithRequires("# A\n\nv2\n", ["src/a.ts"]));
    writeFile(fixture.knowledgeRoot, "docs/b.md", docB("# B\n\nv2\n"));
    writeFile(
      fixture.knowledgeRoot,
      "docs/c.md",
      knowledgeDoc("guide", "Document C", { paths: ["pkg/lease/x.ts"], body: "# C\n\nv2\n" })
    );

    const manifest = await generate(fixture);
    const raw = JSON.parse(fs.readFileSync(reviewFilePath(fixture.knowledgeRoot, manifest.reviewId), "utf8")) as ReviewManifest;
    raw.documents.reverse();
    for (const item of raw.documents) {
      item.oldScope.reverse();
      item.newScope.reverse();
      item.removedScope.reverse();
      item.reasons.reverse();
      item.candidateRequires.reverse();
    }
    raw.writeSet.documents.reverse();
    fs.writeFileSync(reviewFilePath(fixture.knowledgeRoot, manifest.reviewId), `${JSON.stringify(raw, null, 2)}\n`);
    await confirm(fixture, manifest);

    const mutations: Array<[string, (copy: ReviewManifest) => void]> = [
      ["scope member", (copy) => copy.documents[0]!.oldScope.push("pkg/lease/x.ts")],
      ["reason member", (copy) => copy.documents[0]!.reasons.push("bogus additional reason")],
      [
        "requires digest",
        (copy) => {
          copy.documents[0]!.candidateRequires[0]!.digest = "sha256:" + "0".repeat(64);
        }
      ],
      [
        "write set member",
        (copy) => {
          copy.writeSet.documents.pop();
        }
      ]
    ];
    for (const [name, mutate] of mutations) {
      const fresh = await generate(fixture);
      const copy = JSON.parse(fs.readFileSync(reviewFilePath(fixture.knowledgeRoot, fresh.reviewId), "utf8")) as ReviewManifest;
      mutate(copy);
      fs.writeFileSync(reviewFilePath(fixture.knowledgeRoot, fresh.reviewId), `${JSON.stringify(copy, null, 2)}\n`);
      const error = await expectKnowledgeError(() => confirm(fixture, fresh), "E_REVIEW_INVALIDATED", 3);
      expect(error.message, name).not.toHaveLength(0);
    }
  });

  it("detects an in-progress rebase from the state directory even when the process cwd is elsewhere", async () => {
    const fixture = await makeFixture("llmdoc-seal-rebase-path-", [{ id: "a.md", content: docA(), scope: ["src/a.ts"] }]);
    const rebaseDir = path.join(fixture.knowledgeRoot, ".git", "rebase-merge");
    fs.mkdirSync(rebaseDir, { recursive: true });
    try {
      // HEAD stays on the branch, so only the absolute rebase-directory probe can block.
      expect(realPath(process.cwd())).not.toBe(realPath(fixture.knowledgeRoot));
      const context = await resolveKnowledgeWriteContext(fixtureOptions(fixture));
      expect(context.knowledgeHeadState.detached).toBe(false);
      expect(context.knowledgeOperation).toBe("rebase");
      await expectKnowledgeError(
        () =>
          runReview({
            cwd: fixture.source,
            source: fixture.source,
            knowledge: fixture.knowledgeRoot,
            registryDir: fixture.registryDir
          }),
        "E_KNOWLEDGE_NOT_ON_BRANCH",
        3
      );
    } finally {
      fs.rmSync(rebaseDir, { recursive: true, force: true });
    }
  });
});

function committedDigest(fixture: KnowledgeFixture, id: string): string {
  return contentDigest(git(fixture.knowledgeRoot, ["show", `HEAD:docs/${id}`]));
}

function committedExists(fixture: KnowledgeFixture, id: string): boolean {
  return spawnSync("git", ["cat-file", "-e", `HEAD:docs/${id}`], { cwd: fixture.knowledgeRoot, encoding: "utf8" }).status === 0;
}

function metaOf(fixture: KnowledgeFixture): { documents: Record<string, { validatedContentDigest?: string } | undefined> } {
  return JSON.parse(fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")) as {
    documents: Record<string, { validatedContentDigest?: string } | undefined>;
  };
}

function readMeta(fixture: KnowledgeFixture): {
  documents: Record<string, { validatedContentDigest: string; validatedRequires: Record<string, string> }>;
} {
  return JSON.parse(fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")) as {
    documents: Record<string, { validatedContentDigest: string; validatedRequires: Record<string, string> }>;
  };
}

function manifestConsumed(fixture: KnowledgeFixture, id: string): boolean {
  const raw = JSON.parse(
    fs.readFileSync(path.join(fixture.knowledgeRoot, ".llmdoc-cache", "reviews", `${id}.json`), "utf8")
  ) as { consumed: boolean };
  return raw.consumed;
}

async function validityStatus(fixture: KnowledgeFixture, id: string): Promise<string | undefined> {
  const context = await resolveKnowledgeWriteContext(fixtureOptions(fixture));
  return context.validity.byId.get(id)?.status;
}

async function expectStructureBlocked(fixture: KnowledgeFixture, projectedStructureInvalid = true): Promise<void> {
  await expectKnowledgeError(
    () => runReview({ cwd: fixture.source, source: fixture.source, knowledge: fixture.knowledgeRoot, registryDir: fixture.registryDir }),
    "E_STRUCTURE_INVALID",
    2
  );
  if (projectedStructureInvalid) {
    await expectKnowledgeError(() => generate(fixture), "E_STRUCTURE_INVALID", 2);
    return;
  }
  const manifest = await generate(fixture);
  await confirm(fixture, manifest);
  await expectKnowledgeError(() => seal(fixture, manifest.reviewId), "E_STRUCTURE_INVALID", 2);
}
