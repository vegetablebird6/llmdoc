import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { runCli } from "../src/cli.js";
import { contentDigest } from "../src/lib/knowledge/document.js";
import { validateKnowledgeMeta } from "../src/lib/knowledge/meta.js";
import { loadKnowledgeForRead } from "../src/lib/knowledge/read.js";
import { projectKnowledgeViewerState } from "../src/lib/knowledge/viewer-state.js";
import { initKnowledgeRepository } from "../src/lib/knowledge/init.js";
import {
  commitFile,
  expectKnowledgeError,
  git,
  head,
  initRepo,
  knowledgeDoc,
  knowledgeMetaJson,
  makeTempDir,
  realPath,
  writeFile
} from "./knowledge-helpers.js";

const createdDirs: string[] = [];

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort temp cleanup
    }
  }
});

const REPOSITORY_ID = `llmdoc-${"a".repeat(32)}`;
const OTHER_REPOSITORY_ID = `llmdoc-${"b".repeat(32)}`;

interface Fixture {
  base: string;
  registryDir: string;
  source: string;
  knowledge: string;
  repositoryId: string;
  sourceHead: string;
}

async function setup(
  files: Record<string, string>,
  requiresMap: Record<string, string[]> = {}
): Promise<Fixture> {
  const base = makeTempDir("llmdoc-knowledge-r1-");
  createdDirs.push(base);
  const registryDir = `${base}/config/llmdoc`;
  const source = initRepo(`${base}/source`);
  commitFile(source, "src/api/retry.ts", "export const retry = true;\n", "init");
  commitFile(source, "src/api/other.ts", "export const other = true;\n", "other");
  const sourceHead = head(source);
  const init = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });
  const knowledge = init.knowledgeRoot;
  for (const [id, raw] of Object.entries(files)) {
    writeFile(knowledge, `docs/${id}`, raw);
  }
  const documents: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(files)) {
    const requires: Record<string, string> = {};
    for (const dependency of requiresMap[id] ?? []) {
      requires[dependency] = contentDigest(files[dependency]!);
    }
    documents[id] = {
      validatedSourceRevision: sourceHead,
      validatedContentDigest: contentDigest(raw),
      validatedSourcePaths: ["src/api/retry.ts"],
      validatedRequires: requires
    };
  }
  writeFile(knowledge, ".llmdoc/meta.json", knowledgeMetaJson(init.repositoryId, sourceHead, documents));
  git(knowledge, ["add", "-A"]);
  git(knowledge, ["commit", "-m", "docs: seed knowledge"]);
  return { base, registryDir, source: realPath(source), knowledge, repositoryId: init.repositoryId, sourceHead };
}

async function withRegistryDir<T>(registryDir: string, run: () => T | Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
  const previous = process.env[key];
  process.env[key] = path.dirname(registryDir);
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

describe("R1-1 fixed Knowledge snapshot", () => {
  it("reads docs, meta and config from the same committed revision despite worktree tampering", async () => {
    const fixture = await setup({ "a.md": knowledgeDoc("guide", "A") });
    const committedK = head(fixture.knowledge);

    writeFile(fixture.knowledge, ".llmdoc/meta.json", knowledgeMetaJson(fixture.repositoryId, null, {}));
    writeFile(
      fixture.knowledge,
      "llmdoc.yaml",
      `schema: llmdoc.knowledge/v1\nrepositoryId: ${OTHER_REPOSITORY_ID}\nlayoutVersion: 1\nremotes: []\n`
    );

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.knowledgeRevision).toBe(committedK);
    expect(loaded.repositoryId).toBe(fixture.repositoryId);
    expect(loaded.meta?.documents["a.md"]).toBeTruthy();
    expect(loaded.validity.byId.get("a.md")!.status).toBe("current");
  });
});

describe("R1-2 committed source analysis", () => {
  it("stays current for unrelated committed changes and degrades for mapped ones", async () => {
    const fixture = await setup({ "a.md": knowledgeDoc("guide", "A") });

    commitFile(fixture.source, "src/api/other.ts", "export const other = 2;\n", "unrelated change");
    const afterUnrelated = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(afterUnrelated.validity.byId.get("a.md")!.status).toBe("current");

    commitFile(fixture.source, "src/api/retry.ts", "export const retry = false;\n", "mapped change");
    const afterMapped = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(afterMapped.validity.byId.get("a.md")!.status).toBe("needs_review");
    expect(afterMapped.validity.byId.get("a.md")!.reasons.join(" ")).toContain("Related committed source changed");
  });

  it("degrades a validated revision that is not an ancestor of HEAD", async () => {
    const fixture = await setup({ "a.md": knowledgeDoc("guide", "A") });
    commitFile(fixture.source, "src/side.ts", "export const side = true;\n", "side commit");
    const sideCommit = head(fixture.source);
    git(fixture.source, ["reset", "--hard", fixture.sourceHead]);

    const document = contentDigest(fs.readFileSync(path.join(fixture.knowledge, "docs", "a.md"), "utf8"));
    writeFile(
      fixture.knowledge,
      ".llmdoc/meta.json",
      knowledgeMetaJson(fixture.repositoryId, fixture.sourceHead, {
        "a.md": {
          validatedSourceRevision: sideCommit,
          validatedContentDigest: document,
          validatedSourcePaths: ["src/api/retry.ts"],
          validatedRequires: {}
        }
      })
    );
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "forked evidence"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.validity.byId.get("a.md")!.status).toBe("needs_review");
    expect(loaded.validity.byId.get("a.md")!.reasons.join(" ")).toContain("not an ancestor");
  });
});

describe("R1-3 identity and independence", () => {
  it("rejects a meta identity that disagrees with the committed config", async () => {
    const fixture = await setup({ "a.md": knowledgeDoc("guide", "A") });
    const raw = fs.readFileSync(path.join(fixture.knowledge, "docs", "a.md"), "utf8");
    writeFile(
      fixture.knowledge,
      ".llmdoc/meta.json",
      knowledgeMetaJson(OTHER_REPOSITORY_ID, fixture.sourceHead, {
        "a.md": {
          validatedSourceRevision: fixture.sourceHead,
          validatedContentDigest: contentDigest(raw),
          validatedSourcePaths: ["src/api/retry.ts"],
          validatedRequires: {}
        }
      })
    );
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "mismatched identity"]);

    await expectKnowledgeError(
      () => loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir }),
      "E_SOURCE_IDENTITY_MISMATCH"
    );
  });

  it("rejects the same common Git and never claims current without a precise association", async () => {
    const fixture = await setup({ "a.md": knowledgeDoc("guide", "A") });

    await expectKnowledgeError(
      () => loadKnowledgeForRead({ sourceInput: fixture.source, knowledgeInput: fixture.source, registryDir: fixture.registryDir }),
      "E_GIT_IDENTITY_CONFLICT"
    );

    const loaded = await loadKnowledgeForRead({
      sourceInput: fixture.source,
      knowledgeInput: fixture.knowledge,
      registryDir: `${fixture.base}/unused-registry`
    });
    expect(loaded.mode).toBe("explicit");
    expect(loaded.identityVerified).toBe(false);
    expect(loaded.validity.byId.get("a.md")!.status).not.toBe("current");
    expect(loaded.validity.byId.get("a.md")!.reasons.join(" ")).toContain("No provable source/knowledge identity association");
  });
});

describe("R1-4 CLI projection", () => {
  it("exposes knowledgeRevision, lastGlobalReviewRevision, sourceBlockers and issues on every read command", async () => {
    const fixture = await setup({ "a.md": knowledgeDoc("guide", "A") });
    const commands: string[][] = [
      ["--json", "tree", "--source", fixture.source],
      ["--json", "index", "--source", fixture.source],
      ["--json", "show", "a.md", "--source", fixture.source],
      ["--json", "search", "A", "--source", fixture.source],
      ["--json", "context", "--files", "src/api/retry.ts", "--source", fixture.source]
    ];
    await withRegistryDir(fixture.registryDir, async () => {
      for (const argv of commands) {
        const result = await runCli(argv, fixture.base);
        expect(result.exitCode).toBe(0);
        const payload = JSON.parse(result.stdout) as {
          mode: string;
          knowledgeRevision: string | null;
          lastGlobalReviewRevision: string | null;
          sourceBlockers: Array<{ code: string }>;
          issues: unknown[];
        };
        expect(payload.mode).toBe("bound");
        expect(payload.knowledgeRevision).toBe(head(fixture.knowledge));
        expect(payload.lastGlobalReviewRevision).toBe(fixture.sourceHead);
        expect(payload.sourceBlockers).toEqual([]);
        expect(Array.isArray(payload.issues)).toBe(true);
      }

      writeFile(fixture.source, "src/api/dirty.ts", "export const dirty = true;\n");
      const dirty = await runCli(["--json", "index", "--source", fixture.source], fixture.base);
      const dirtyPayload = JSON.parse(dirty.stdout) as {
        sourceBlockers: Array<{ code: string }>;
        documents: Array<{ id: string; status: string }>;
      };
      expect(dirtyPayload.sourceBlockers.some((blocker) => blocker.code === "source_dirty")).toBe(true);
      expect(dirtyPayload.documents.find((entry) => entry.id === "a.md")!.status).toBe("current");
    });
  });
});

describe("R1-5 single canonical relation graph", () => {
  it("normalizes ./ and backslash targets once and reuses them everywhere", async () => {
    const files = {
      "a.md": knowledgeDoc("guide", "A", { requires: ["./b.md", "refs\\api.md"] }),
      "b.md": knowledgeDoc("guide", "B"),
      "refs/api.md": knowledgeDoc("reference", "API")
    };
    const fixture = await setup(files, { "a.md": ["b.md", "refs/api.md"] });
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });

    expect(loaded.model.byId.get("a.md")!.frontmatter.relations?.requires).toEqual(["b.md", "refs/api.md"]);
    expect(loaded.validity.byId.get("a.md")!.status).toBe("current");

    const viewer = projectKnowledgeViewerState(loaded);
    const edges = viewer.edges
      .filter((edge) => edge.from === "a.md" && edge.type === "requires")
      .map((edge) => edge.to)
      .sort();
    expect(edges).toEqual(["b.md", "refs/api.md"]);

    const context = await withRegistryDir(fixture.registryDir, () =>
      runCli(["--json", "context", "--files", "src/api/retry.ts", "--source", fixture.source], fixture.base)
    );
    const payload = JSON.parse(context.stdout) as { prerequisites: Array<{ id: string }> };
    expect(payload.prerequisites.map((entry) => entry.id)).toEqual(["b.md", "refs/api.md"]);
  });
});

describe("R1-6 supersedes does not change validity", () => {
  it("keeps supersedes cycles structural while both decisions stay current", async () => {
    const fixture = await setup({
      "old.md": knowledgeDoc("decision", "Old", { supersedes: ["new.md"] }),
      "new.md": knowledgeDoc("decision", "New", { supersedes: ["old.md"] })
    });
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });

    expect(loaded.model.issues.some((issue) => issue.code === "relations.supersedes.cycle")).toBe(true);
    expect(loaded.model.cyclicIds.size).toBe(0);
    expect(loaded.validity.byId.get("old.md")!.status).toBe("current");
    expect(loaded.validity.byId.get("new.md")!.status).toBe("current");
    expect(loaded.model.supersededBy.get("old.md")).toEqual(["new.md"]);
  });
});

describe("R1-7 grouped validation evidence", () => {
  const base = {
    schema: "llmdoc.meta/v3-ng",
    source: { repositoryId: REPOSITORY_ID, lastGlobalReviewRevision: null }
  };

  it("rejects partial or non-canonical evidence tuples", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(() =>
      validateKnowledgeMeta(
        {
          ...base,
          documents: {
            "a.md": {
              validatedSourceRevision: null,
              validatedContentDigest: null,
              validatedSourcePaths: ["src/a.ts"],
              validatedRequires: {}
            }
          }
        },
        "meta.json"
      )
    ).toThrow(/partial validation evidence/);

    expect(() =>
      validateKnowledgeMeta(
        {
          ...base,
          documents: {
            "a.md": {
              validatedSourceRevision: null,
              validatedContentDigest: digest,
              validatedSourcePaths: ["src/a.ts"],
              validatedRequires: {}
            }
          }
        },
        "meta.json"
      )
    ).toThrow(/no validated source revision/);

    expect(() =>
      validateKnowledgeMeta(
        {
          ...base,
          documents: {
            "../evil.md": {
              validatedSourceRevision: null,
              validatedContentDigest: null,
              validatedSourcePaths: [],
              validatedRequires: {}
            }
          }
        },
        "meta.json"
      )
    ).toThrow(/canonical docs-relative/);

    expect(() =>
      validateKnowledgeMeta(
        {
          ...base,
          documents: {
            "a.md": {
              validatedSourceRevision: "abc123",
              validatedContentDigest: digest,
              validatedSourcePaths: ["src/a.ts"],
              validatedRequires: {}
            }
          }
        },
        "meta.json"
      )
    ).toThrow(/full commit OID/);
  });

  it("treats a committed invalid ledger as unverified instead of trusting it", async () => {
    const fixture = await setup({ "a.md": knowledgeDoc("guide", "A") });
    writeFile(
      fixture.knowledge,
      ".llmdoc/meta.json",
      knowledgeMetaJson(fixture.repositoryId, null, {
        "a.md": {
          validatedSourceRevision: null,
          validatedContentDigest: null,
          validatedSourcePaths: ["src/api/retry.ts"],
          validatedRequires: {}
        }
      })
    );
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "invalid evidence"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.meta).toBeNull();
    expect(loaded.issues.some((issue) => issue.code === "meta.invalid")).toBe(true);
    expect(loaded.validity.byId.get("a.md")!.status).toBe("unverified");
  });
});
