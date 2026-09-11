import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 60000 });

import { git, head, initRepo, makeTempDir, snapshotWorktree, writeFile } from "./knowledge-helpers.js";
import { migrateKnowledge } from "../src/lib/knowledge/migrate.js";
import { findTargetCollisions } from "../src/lib/knowledge/legacy.js";
import { readRegistryDocument } from "../src/lib/knowledge/registry.js";
import { loadKnowledgeForRead } from "../src/lib/knowledge/read.js";

interface LegacyFixture {
  base: string;
  source: string;
  registryDir: string;
  target: string;
}

function legacyMeta(documents: Record<string, string | null>): string {
  return `${JSON.stringify(
    {
      schema: "llmdoc.meta/v3",
      baseline: { revision: "a".repeat(40), verifiedAt: "2026-01-01T00:00:00Z" },
      documents: Object.fromEntries(Object.entries(documents).map(([id, revision]) => [id, { validatedRevision: revision }])),
      convergence: { capturedAt: "2026-01-01T00:00:00Z", source: "init", documentCount: 2, totalEstimatedTokens: 10 }
    },
    null,
    2
  )}\n`;
}

function createLegacyFixture(prefix: string): LegacyFixture {
  const base = makeTempDir(prefix);
  const source = initRepo(path.join(base, "source"));
  writeFile(source, "src/api/retry.ts", "export const retry = 1;\n");
  writeFile(source, "src/api/errors.ts", "export const RETRYABLE = true;\n");
  writeFile(
    source,
    "llmdoc/a.mdx",
    [
      "---",
      "description: Retry policy",
      "kind: guide",
      "code:",
      "  paths:",
      "    - src/api/retry.ts",
      "---",
      "",
      "# Retry",
      "",
      "See <CodeRef path=\"src/api/retry.ts\" symbol=\"retry\" /> and [errors](b.mdx).",
      ""
    ].join("\n")
  );
  writeFile(
    source,
    "llmdoc/b.mdx",
    ["---", "description: Error model", "kind: reference", "code:", "  paths:", "    - src/api/errors.ts", "---", "", "# Errors", ""].join("\n")
  );
  // A document with no source evidence scope cannot be losslessly converted and is skipped.
  writeFile(source, "llmdoc/no-scope.mdx", ["---", "description: No scope", "kind: guide", "---", "", "# No scope", ""].join("\n"));
  writeFile(source, "llmdoc/meta.json", legacyMeta({ "a.mdx": "b".repeat(40), "b.mdx": null }));
  writeFile(source, "llmdoc.config.json", `${JSON.stringify({ schema: "llmdoc.config/v1", startup: { preload: ["a.mdx"] } }, null, 2)}\n`);
  git(source, ["add", "-A"]);
  git(source, ["commit", "-m", "legacy knowledge"]);
  return { base, source, registryDir: path.join(base, "registry"), target: path.join(base, "knowledge") };
}

describe("knowledge migrate", () => {
  test("dry-run reports every mapping and conflict with zero modifications", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-dry-");
    const sourceHead = head(fixture.source);
    const sourceSnapshot = snapshotWorktree(fixture.source);

    const result = await migrateKnowledge({
      sourceInput: fixture.source,
      knowledgeInput: fixture.target,
      registryDir: fixture.registryDir,
      dryRun: true
    });

    expect(result.status).toBe("dry_run");
    expect(result.bound).toBe(false);
    expect(fs.existsSync(fixture.target)).toBe(false);
    const byLegacy = new Map(result.documents.map((document) => [document.legacyId, document]));
    expect(byLegacy.get("a.mdx")?.status).toBe("converted");
    expect(byLegacy.get("a.mdx")?.targetId).toBe("a.md");
    expect(byLegacy.get("a.mdx")?.codeRefs).toBe(1);
    expect(byLegacy.get("a.mdx")?.linksRewritten).toBe(1);
    expect(byLegacy.get("a.mdx")?.requires).toEqual([]);
    expect(byLegacy.get("no-scope.mdx")?.status).toBe("skipped");
    expect(byLegacy.get("no-scope.mdx")?.issues.some((issue) => issue.code === "legacy.source-scope.missing")).toBe(true);
    expect(result.config?.preload).toEqual(["a.mdx"]);
    expect(result.legacyMeta?.validatedRevisions["a.mdx"]).toBe("b".repeat(40));

    // Legacy repository, source worktree and target are byte-for-byte unchanged.
    expect(head(fixture.source)).toBe(sourceHead);
    expect(snapshotWorktree(fixture.source)).toEqual(sourceSnapshot);
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
  });

  test("migrates losslessly into a new independent Git with a null-evidence baseline and a written binding", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-run-");
    const sourceHead = head(fixture.source);
    const legacyBefore = fs.readFileSync(path.join(fixture.source, "llmdoc", "a.mdx"), "utf8");

    const result = await migrateKnowledge({
      sourceInput: fixture.source,
      knowledgeInput: fixture.target,
      registryDir: fixture.registryDir,
      dryRun: false
    });

    expect(result.status).toBe("migrated");
    expect(result.bound).toBe(true);
    expect(result.repositoryId).toMatch(/^llmdoc-[0-9a-f]{32}$/);
    expect(fs.existsSync(path.join(fixture.target, ".git"))).toBe(true);

    const docA = fs.readFileSync(path.join(fixture.target, "docs", "a.md"), "utf8");
    expect(docA).toContain("src/api/retry.ts");
    expect(docA).toContain("`src/api/retry.ts#retry`");
    expect(docA).toContain("(b.md)");
    expect(docA).not.toContain("CodeRef");
    expect(docA).not.toContain(".mdx");
    expect(fs.existsSync(path.join(fixture.target, "docs", "no-scope.md"))).toBe(false);

    const meta = JSON.parse(fs.readFileSync(path.join(fixture.target, ".llmdoc", "meta.json"), "utf8")) as {
      schema: string;
      documents: Record<string, { validatedSourceRevision: string | null; validatedContentDigest: string | null; validatedSourcePaths: string[]; validatedRequires: Record<string, string> }>;
    };
    expect(meta.schema).toBe("llmdoc.meta/v3-ng");
    expect(meta.documents["a.md"]).toEqual({
      validatedSourceRevision: null,
      validatedContentDigest: null,
      validatedSourcePaths: [],
      validatedRequires: {}
    });

    const config = fs.readFileSync(path.join(fixture.target, "llmdoc.yaml"), "utf8");
    expect(config).toContain(result.repositoryId!);

    const registry = readRegistryDocument(fixture.registryDir);
    expect(registry.bindings).toHaveLength(1);
    expect(registry.bindings[0]!.repositoryId).toBe(result.repositoryId);
    expect(registry.bindings[0]!.knowledgeRoot).toBe(fs.realpathSync(fixture.target));

    // The migrated knowledge reads as a v3-ng repository; legacy files and source are untouched.
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.model.byId.has("a.md")).toBe(true);
    expect(loaded.model.byId.has("a.mdx")).toBe(false);
    expect(loaded.validity.byId.get("a.md")?.status).toBe("unverified");
    expect(fs.readFileSync(path.join(fixture.source, "llmdoc", "a.mdx"), "utf8")).toBe(legacyBefore);
    expect(head(fixture.source)).toBe(sourceHead);
  });

  test("re-running does not overwrite target drafts and reports already_migrated", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-rerun-");
    const first = await migrateKnowledge({
      sourceInput: fixture.source,
      knowledgeInput: fixture.target,
      registryDir: fixture.registryDir,
      dryRun: false
    });
    expect(first.status).toBe("migrated");
    writeFile(fixture.target, "docs/draft.md", "# Draft\n");
    const knowledgeHeadBefore = head(fixture.target);

    const second = await migrateKnowledge({
      sourceInput: fixture.source,
      knowledgeInput: fixture.target,
      registryDir: fixture.registryDir,
      dryRun: false
    });
    expect(second.status).toBe("already_migrated");
    expect(fs.readFileSync(path.join(fixture.target, "docs", "draft.md"), "utf8")).toBe("# Draft\n");
    expect(head(fixture.target)).toBe(knowledgeHeadBefore);
    expect(readRegistryDocument(fixture.registryDir).bindings).toHaveLength(1);
  });

  test("refuses a non-empty target and writes no binding", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-nonempty-");
    fs.mkdirSync(fixture.target, { recursive: true });
    writeFile(fixture.target, "existing.md", "keep me\n");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false
      })
    ).rejects.toMatchObject({ code: "E_INIT_TARGET_NOT_EMPTY" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.readFileSync(path.join(fixture.target, "existing.md"), "utf8")).toBe("keep me\n");
  });

  test("leaves no half-binding when the target cannot be created", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-iofail-");
    const parentFile = path.join(fixture.base, "blocked");
    fs.writeFileSync(parentFile, "not a directory");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: path.join(parentFile, "knowledge"),
        registryDir: fixture.registryDir,
        dryRun: false
      })
    ).rejects.toBeTruthy();
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
  });

  test("detects extension/ID target collisions on case-insensitive platforms", () => {
    const collisions = findTargetCollisions(["a.md", "A.md"]);
    if (process.platform === "win32") {
      expect(collisions).toEqual([["a.md", "A.md"]]);
    } else {
      expect(collisions).toEqual([]);
    }
  });

  test("renders real navigation into the migration baseline commit", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-nav-");
    await migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: fixture.target, registryDir: fixture.registryDir, dryRun: false });
    const readme = fs.readFileSync(path.join(fixture.target, "README.md"), "utf8");
    expect(readme).toContain("<!-- llmdoc:navigation:start -->");
    expect(readme).toContain("(docs/a.md)");
    expect(readme).not.toContain("(docs/no-scope.md)");
    const committed = git(fixture.target, ["ls-tree", "-r", "--name-only", "HEAD"]);
    expect(committed).toContain("README.md");
  });

  test("conservatively skips unsupported JSX/MDX and unparseable CodeRef", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-unsupported-");
    writeFile(
      fixture.source,
      "llmdoc/widget.mdx",
      ["---", "description: Widget", "kind: guide", "code:", "  paths:", "    - src/api/retry.ts", "---", "", '<Widget foo="bar" />', ""].join("\n")
    );
    writeFile(
      fixture.source,
      "llmdoc/badcoderef.mdx",
      ["---", "description: Bad CodeRef", "kind: guide", "code:", "  paths:", "    - src/api/retry.ts", "---", "", '<CodeRef path="src/api/retry.ts">inline</CodeRef>', ""].join("\n")
    );
    const result = await migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: fixture.target, registryDir: fixture.registryDir, dryRun: true });
    const byLegacy = new Map(result.documents.map((document) => [document.legacyId, document]));
    for (const id of ["widget.mdx", "badcoderef.mdx"]) {
      expect(byLegacy.get(id)?.status).toBe("skipped");
      expect(byLegacy.get(id)?.issues.some((issue) => issue.code === "legacy.conversion.unsupported")).toBe(true);
    }
  });

  test("drops relations and links that point at skipped documents without dangling references", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-dangling-");
    writeFile(
      fixture.source,
      "llmdoc/ref.mdx",
      [
        "---",
        "description: Ref",
        "kind: guide",
        "code:",
        "  paths:",
        "    - src/api/retry.ts",
        "relations:",
        "  requires:",
        "    - no-scope.mdx",
        "---",
        "",
        "See [no scope](no-scope.mdx) and [a](a.mdx).",
        ""
      ].join("\n")
    );
    const result = await migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: fixture.target, registryDir: fixture.registryDir, dryRun: false });
    expect(result.status).toBe("migrated");
    const ref = fs.readFileSync(path.join(fixture.target, "docs", "ref.md"), "utf8");
    expect(ref).not.toContain("no-scope");
    expect(ref).toContain("(a.md)");
    const summary = result.documents.find((document) => document.legacyId === "ref.mdx")!;
    expect(summary.requires).toEqual([]);
    expect(summary.issues.some((issue) => issue.code === "legacy.relation.target-skipped")).toBe(true);
    expect(summary.issues.some((issue) => issue.code === "legacy.link.target-skipped")).toBe(true);
  });

  test("refuses targets that overlap the legacy knowledge root", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-overlap-");
    const attempts = [
      path.join(fixture.source, "llmdoc"),
      path.join(fixture.source, "llmdoc", "nested-target"),
      fixture.source
    ];
    for (const target of attempts) {
      await expect(
        migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: target, registryDir: fixture.registryDir, dryRun: false })
      ).rejects.toMatchObject({ code: "E_MIGRATION_TARGET_OVERLAP" });
    }
    // dry-run still reports without touching the legacy tree.
    const dry = await migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: path.join(fixture.source, "llmdoc"), registryDir: fixture.registryDir, dryRun: true });
    expect(dry.status).toBe("dry_run");
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
  });

  test("rejects a target that reaches the legacy root through a junction/symlink", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-junction-");
    const link = path.join(fixture.base, "link-to-legacy");
    try {
      fs.symlinkSync(path.join(fixture.source, "llmdoc"), link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // platform does not permit junction/symlink creation
    }
    const before = snapshotWorktree(fixture.source);
    await expect(
      migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: link, registryDir: fixture.registryDir, dryRun: false })
    ).rejects.toMatchObject({ code: "E_MIGRATION_TARGET_OVERLAP" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(snapshotWorktree(fixture.source)).toEqual(before);
  });

  test("removes a created target on failure and allows a clean retry", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-retry-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeTargetValidate: () => {
            throw new Error("injected validation failure");
          }
        }
      })
    ).rejects.toThrow("injected validation failure");
    expect(fs.existsSync(fixture.target)).toBe(false);
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);

    const retry = await migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: fixture.target, registryDir: fixture.registryDir, dryRun: false });
    expect(retry.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.target, ".git"))).toBe(true);
  });

  test("removes a created target when the registry write fails", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-regfail-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeRegistryWrite: () => {
            throw new Error("injected registry failure");
          }
        }
      })
    ).rejects.toThrow("injected registry failure");
    expect(fs.existsSync(fixture.target)).toBe(false);
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
  });

  test("cleans a pre-existing empty target precisely and keeps the directory", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-preclean-");
    fs.mkdirSync(fixture.target, { recursive: true });
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeTargetValidate: () => {
            throw new Error("injected failure");
          }
        }
      })
    ).rejects.toThrow("injected failure");
    expect(fs.existsSync(fixture.target)).toBe(true);
    expect(fs.readdirSync(fixture.target)).toEqual([]);
  });

  test("aborts and cleans up when a legacy input changes during migration", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-digest-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeTargetValidate: () => {
            writeFile(fixture.source, "llmdoc/a.mdx", "# changed during migration\n");
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_LEGACY_CHANGED" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.existsSync(fixture.target)).toBe(false);
  });

  test("does not report already_migrated for a damaged target", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-corrupt-");
    const first = await migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: fixture.target, registryDir: fixture.registryDir, dryRun: false });
    expect(first.status).toBe("migrated");
    fs.rmSync(path.join(fixture.target, "llmdoc.yaml"));
    await expect(
      migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: fixture.target, registryDir: fixture.registryDir, dryRun: false })
    ).rejects.toMatchObject({ code: "E_KNOWLEDGE_NOT_INITIALIZED" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toHaveLength(1);
  });

  test("re-enumerates legacy inputs before binding: a beforeRegistryWrite edit aborts", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-reg-edit-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeRegistryWrite: () => {
            writeFile(fixture.source, "llmdoc/a.mdx", "# rewritten during binding seam\n");
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_LEGACY_CHANGED" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.existsSync(fixture.target)).toBe(false);
  });

  test("re-enumerates legacy inputs before binding: a new .mdx aborts", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-reg-add-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeRegistryWrite: () => {
            writeFile(
              fixture.source,
              "llmdoc/added.mdx",
              ["---", "description: Added", "kind: guide", "code:", "  paths:", "    - src/api/retry.ts", "---", "", "# Added", ""].join("\n")
            );
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_LEGACY_CHANGED" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.existsSync(fixture.target)).toBe(false);
  });

  test("re-enumerates legacy inputs before binding: a deleted legacy file aborts", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-reg-delete-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeRegistryWrite: () => {
            fs.rmSync(path.join(fixture.source, "llmdoc", "b.mdx"));
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_LEGACY_CHANGED" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.existsSync(fixture.target)).toBe(false);
  });

  test("revalidates the committed target after beforeRegistryWrite and never binds drift", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-final-target-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeRegistryWrite: () => {
            writeFile(fixture.target, "late.md", "late external commit\n");
            git(fixture.target, ["add", "late.md"]);
            git(fixture.target, ["-c", "user.email=t@example.com", "-c", "user.name=Test", "commit", "-m", "late drift"]);
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_FILESYSTEM_IO" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.readFileSync(path.join(fixture.target, "late.md"), "utf8")).toBe("late external commit\n");
  });

  test("validates the committed target before binding: a removed worktree config aborts and is cleaned", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-noconfig-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: { beforeTargetValidate: () => fs.rmSync(path.join(fixture.target, "llmdoc.yaml")) }
      })
    ).rejects.toMatchObject({ code: "E_KNOWLEDGE_NOT_INITIALIZED" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.existsSync(fixture.target)).toBe(false);
  });

  test("validates the committed target before binding: tampered meta bytes are preserved and never bound", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-tamper-meta-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: { beforeTargetValidate: () => writeFile(fixture.target, ".llmdoc/meta.json", "{\n  \"schema\": \"tampered\"\n}\n") }
      })
    ).rejects.toMatchObject({ code: "E_FILESYSTEM_IO" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.readFileSync(path.join(fixture.target, ".llmdoc", "meta.json"), "utf8")).toContain("tampered");
  });

  test("validates the committed target before binding: an extra worktree file is preserved and never bound", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-tamper-extra-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: { beforeTargetValidate: () => writeFile(fixture.target, "external.md", "unexpected\n") }
      })
    ).rejects.toMatchObject({ code: "E_FILESYSTEM_IO" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.readFileSync(path.join(fixture.target, "external.md"), "utf8")).toBe("unexpected\n");
  });

  test("validates the committed target before binding: a moved HEAD aborts", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-head-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeTargetValidate: () => {
            writeFile(fixture.target, "extra.md", "x\n");
            git(fixture.target, ["add", "extra.md"]);
            git(fixture.target, ["-c", "user.email=t@example.com", "-c", "user.name=Test", "commit", "-m", "extra"]);
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_FILESYSTEM_IO" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    expect(fs.readFileSync(path.join(fixture.target, "extra.md"), "utf8")).toBe("x\n");
  });

  test("preserves concurrent external bytes and reports residual without binding", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-concurrent-");
    await expect(
      migrateKnowledge({
        sourceInput: fixture.source,
        knowledgeInput: fixture.target,
        registryDir: fixture.registryDir,
        dryRun: false,
        testHooks: {
          beforeTargetInit: () => {
            writeFile(fixture.target, "external.txt", "keep me\n");
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_FILESYSTEM_IO" });
    expect(readRegistryDocument(fixture.registryDir).bindings).toEqual([]);
    // The external bytes survive cleanup; only llmdoc's own generated paths are removed.
    expect(fs.readFileSync(path.join(fixture.target, "external.txt"), "utf8")).toBe("keep me\n");
  });

  test("conservatively skips CodeRef with extra/dynamic attributes and MDX expressions/fragments", async () => {
    const fixture = createLegacyFixture("llmdoc-migrate-lossless-");
    const bodies: Record<string, string> = {
      "extra.mdx": '<CodeRef path="src/api/retry.ts" symbol="retry" line="3" />',
      "dynamic.mdx": '<CodeRef path={source} symbol="retry" />',
      "expr.mdx": "The value is {computeValue()} here.",
      "fragment.mdx": "<>fragment text</>"
    };
    for (const [name, body] of Object.entries(bodies)) {
      writeFile(
        fixture.source,
        `llmdoc/${name}`,
        ["---", `description: ${name}`, "kind: guide", "code:", "  paths:", "    - src/api/retry.ts", "---", "", body, ""].join("\n")
      );
    }
    const result = await migrateKnowledge({ sourceInput: fixture.source, knowledgeInput: fixture.target, registryDir: fixture.registryDir, dryRun: true });
    const byLegacy = new Map(result.documents.map((document) => [document.legacyId, document]));
    for (const name of Object.keys(bodies)) {
      expect(byLegacy.get(name)?.status).toBe("skipped");
      expect(byLegacy.get(name)?.issues.some((issue) => issue.code === "legacy.conversion.unsupported")).toBe(true);
    }
  });
});
