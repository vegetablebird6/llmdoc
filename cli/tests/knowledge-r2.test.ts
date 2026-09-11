import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { runCli } from "../src/cli.js";
import { canonicalizeSourcePath, contentDigest } from "../src/lib/knowledge/document.js";
import { normalizeDocTarget } from "../src/lib/knowledge/knowledge-model.js";
import { loadKnowledgeForRead } from "../src/lib/knowledge/read.js";
import { projectKnowledgeViewerState } from "../src/lib/knowledge/viewer-state.js";
import { initKnowledgeRepository } from "../src/lib/knowledge/init.js";
import {
  commitFile,
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

interface DocSpec {
  kind?: string;
  description?: string;
  paths?: string[];
  requires?: string[];
  supersedes?: string[];
  body?: string;
}

interface Fixture {
  base: string;
  registryDir: string;
  source: string;
  knowledge: string;
  repositoryId: string;
  sourceHead: string;
}

async function seed(
  prefix: string,
  docs: Record<string, DocSpec>,
  sourceFiles: Record<string, string> = { "src/api/retry.ts": "export const retry = true;\n" }
): Promise<Fixture> {
  const base = makeTempDir(prefix);
  createdDirs.push(base);
  const registryDir = `${base}/config/llmdoc`;
  const source = initRepo(`${base}/source`);
  for (const [rel, content] of Object.entries(sourceFiles)) {
    commitFile(source, rel, content, `add ${rel}`);
  }
  const sourceHead = head(source);
  const init = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });
  const knowledge = init.knowledgeRoot;

  const rawById: Record<string, string> = {};
  for (const [id, spec] of Object.entries(docs)) {
    const raw = knowledgeDoc(spec.kind ?? "guide", spec.description ?? id, {
      paths: spec.paths ?? ["src/api/retry.ts"],
      requires: spec.requires,
      supersedes: spec.supersedes,
      body: spec.body
    });
    rawById[id] = raw;
    writeFile(knowledge, `docs/${id}`, raw);
  }

  const documents: Record<string, unknown> = {};
  for (const [id, spec] of Object.entries(docs)) {
    const canonicalPaths = [
      ...new Set((spec.paths ?? ["src/api/retry.ts"]).map((entry) => canonicalizeSourcePath(entry) ?? entry))
    ].sort();
    const validatedRequires: Record<string, string> = {};
    for (const target of spec.requires ?? []) {
      const canonical = normalizeDocTarget(target);
      if (!canonical || canonical === id || !rawById[canonical]) {
        continue;
      }
      validatedRequires[canonical] = contentDigest(rawById[canonical]!);
    }
    documents[id] = {
      validatedSourceRevision: sourceHead,
      validatedContentDigest: contentDigest(rawById[id]!),
      validatedSourcePaths: canonicalPaths,
      validatedRequires
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

describe("R2-1 fixed-S source scope evidence", () => {
  it("never marks current for a missing literal or a zero-match glob, but keeps a matching glob current", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-scope-", {
      "missing-literal.md": { description: "Missing literal", paths: ["src/does-not-exist.ts"] },
      "empty-glob.md": { description: "Empty glob", paths: ["src/does-not-exist/**"] },
      "matched-glob.md": { description: "Matched glob", paths: ["src/api/**"] }
    });

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });

    expect(loaded.validity.byId.get("missing-literal.md")!.status).toBe("needs_review");
    expect(
      loaded.issues.some((issue) => issue.code === "source.paths.missing" && issue.path === "missing-literal.md")
    ).toBe(true);

    expect(loaded.validity.byId.get("empty-glob.md")!.status).toBe("needs_review");
    expect(
      loaded.issues.some((issue) => issue.code === "source.paths.glob-empty" && issue.path === "empty-glob.md")
    ).toBe(true);

    expect(loaded.validity.byId.get("matched-glob.md")!.status).toBe("current");
    expect(
      loaded.issues.some((issue) => issue.path === "matched-glob.md" && issue.code.startsWith("source.paths."))
    ).toBe(false);
  });

  it("does not count an uncommitted live worktree file toward the fixed source revision", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-live-", {
      "live-glob.md": { description: "Live glob", paths: ["src/live/**"] }
    });
    writeFile(fixture.source, "src/live/untracked.ts", "export const live = true;\n");

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.validity.byId.get("live-glob.md")!.status).toBe("needs_review");
    expect(
      loaded.issues.some((issue) => issue.code === "source.paths.glob-empty" && issue.path === "live-glob.md")
    ).toBe(true);
    expect(loaded.source?.clean).toBe(false);
  });

  it("rejects a non-canonical source path alias as a structural issue", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-canon-", {
      "alias.md": { description: "Alias", paths: ["src\\api\\retry.ts"] }
    });
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.issues.some((issue) => issue.code === "source.paths.invalid" && issue.path === "alias.md")).toBe(true);
    expect(loaded.validity.byId.get("alias.md")!.status).not.toBe("current");
  });

  it("does not hide an invalid source path when the remaining canonical scope matches the ledger", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-mixed-canon-", {
      "mixed.md": {
        description: "Mixed scope",
        paths: ["src/api/retry.ts", "src\\api\\retry.ts"]
      }
    });
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.model.byId.get("mixed.md")!.frontmatter.source.paths).toEqual(["src/api/retry.ts"]);
    expect(loaded.issues.some((issue) => issue.code === "source.paths.invalid" && issue.path === "mixed.md")).toBe(true);
    expect(loaded.validity.byId.get("mixed.md")!.status).toBe("needs_review");
  });
});

describe("R2-2 SourceContext history blockers", () => {
  it("reports history_unavailable and never claims full history for a missing revision", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-missing-", { "a.md": { description: "A" } });
    const raw = fs.readFileSync(path.join(fixture.knowledge, "docs", "a.md"), "utf8");
    writeFile(
      fixture.knowledge,
      ".llmdoc/meta.json",
      knowledgeMetaJson(fixture.repositoryId, fixture.sourceHead, {
        "a.md": {
          validatedSourceRevision: "f".repeat(40),
          validatedContentDigest: contentDigest(raw),
          validatedSourcePaths: ["src/api/retry.ts"],
          validatedRequires: {}
        }
      })
    );
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "missing revision evidence"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    const doc = loaded.validity.byId.get("a.md")!;
    expect(doc.status).toBe("needs_review");
    expect(doc.reasons.join(" ")).toContain("not available in history");
    expect(loaded.validity.sourceBlockers.some((blocker) => blocker.code === "history_unavailable")).toBe(true);
    expect(loaded.validity.historyAvailable).toBe(false);

    const viewer = projectKnowledgeViewerState(loaded);
    expect(viewer.sourceBlockers.some((blocker) => blocker.code === "history_unavailable")).toBe(true);
    expect(viewer.historyAvailable).toBe(false);

    await withRegistryDir(fixture.registryDir, async () => {
      const result = await runCli(["--json", "index", "--source", fixture.source], fixture.base);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        sourceBlockers: Array<{ code: string }>;
        historyAvailable: boolean;
        documents: Array<{ id: string; status: string; reasons: string[] }>;
      };
      expect(payload.sourceBlockers.some((blocker) => blocker.code === "history_unavailable")).toBe(true);
      expect(payload.historyAvailable).toBe(false);
      const entry = payload.documents.find((document) => document.id === "a.md")!;
      expect(entry.status).toBe("needs_review");
      expect(entry.reasons.join(" ")).toContain("not available in history");

      const commands = [
        ["--json", "tree", "--source", fixture.source],
        ["--json", "show", "a.md", "--source", fixture.source],
        ["--json", "search", "A", "--source", fixture.source],
        ["--json", "context", "--files", "src/api/retry.ts", "--source", fixture.source]
      ];
      for (const argv of commands) {
        const commandResult = await runCli(argv, fixture.base);
        expect(commandResult.exitCode).toBe(0);
        expect((JSON.parse(commandResult.stdout) as { historyAvailable: boolean }).historyAvailable).toBe(false);
      }
    });
  });

  it("reports missing history even when a digest mismatch already makes the document stale", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-missing-digest-", { "a.md": { description: "A" } });
    const original = fs.readFileSync(path.join(fixture.knowledge, "docs", "a.md"), "utf8");
    writeFile(
      fixture.knowledge,
      ".llmdoc/meta.json",
      knowledgeMetaJson(fixture.repositoryId, fixture.sourceHead, {
        "a.md": {
          validatedSourceRevision: "e".repeat(40),
          validatedContentDigest: contentDigest(original),
          validatedSourcePaths: ["src/api/retry.ts"],
          validatedRequires: {}
        }
      })
    );
    writeFile(fixture.knowledge, "docs/a.md", original.replace("# A", "# Changed title"));
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "stale digest and missing source history"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.validity.byId.get("a.md")!.reasons.join(" ")).toContain("digest mismatch");
    expect(loaded.validity.sourceBlockers.some((blocker) => blocker.code === "history_unavailable")).toBe(true);
    expect(loaded.validity.historyAvailable).toBe(false);
  });

  it("reports diverged when a validated revision is not an ancestor of HEAD", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-diverge-", { "a.md": { description: "A" } });
    commitFile(fixture.source, "src/side.ts", "export const side = true;\n", "side");
    const sideCommit = head(fixture.source);
    git(fixture.source, ["reset", "--hard", fixture.sourceHead]);

    const raw = fs.readFileSync(path.join(fixture.knowledge, "docs", "a.md"), "utf8");
    writeFile(
      fixture.knowledge,
      ".llmdoc/meta.json",
      knowledgeMetaJson(fixture.repositoryId, fixture.sourceHead, {
        "a.md": {
          validatedSourceRevision: sideCommit,
          validatedContentDigest: contentDigest(raw),
          validatedSourcePaths: ["src/api/retry.ts"],
          validatedRequires: {}
        }
      })
    );
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "diverged revision evidence"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    const doc = loaded.validity.byId.get("a.md")!;
    expect(doc.status).toBe("needs_review");
    expect(doc.reasons.join(" ")).toContain("not an ancestor");
    expect(loaded.validity.sourceBlockers.some((blocker) => blocker.code === "diverged")).toBe(true);
    expect(loaded.validity.historyAvailable).toBe(false);
    expect(projectKnowledgeViewerState(loaded).sourceBlockers.some((blocker) => blocker.code === "diverged")).toBe(true);
  });
});

describe("R2-3 single canonical relation graph", () => {
  it("uses canonical requires edges for dependency ordering and validity", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-topology-", {
      "a-dependent.md": { description: "Dependent", requires: ["./z-dependency.md"] },
      "z-dependency.md": { description: "Dependency" }
    });
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.model.relations.get("a-dependent.md")!.requires).toEqual(["z-dependency.md"]);
    expect(loaded.validity.byId.get("z-dependency.md")!.status).toBe("current");
    expect(loaded.validity.byId.get("a-dependent.md")!.status).toBe("current");
  });

  it("filters missing/self/invalid edges once and exposes the same graph in every projection", async () => {
    const fixture = await seed("llmdoc-knowledge-r2-graph-", {
      "guides/a.md": {
        description: "A",
        requires: ["guides/b.md", "guides/a.md", "guides/missing.md", "../evil.md", "refs\\api.md"]
      },
      "guides/b.md": { description: "B" },
      "refs/api.md": { description: "API", kind: "reference" },
      "decisions/old.md": { description: "Old", kind: "decision" },
      "decisions/new.md": {
        description: "New",
        kind: "decision",
        supersedes: ["decisions/old.md", "decisions/missing.md", "decisions/new.md"]
      }
    });

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });

    expect(loaded.model.relations.get("guides/a.md")!.requires).toEqual(["guides/b.md", "refs/api.md"]);
    expect(loaded.model.requiresProblems.has("guides/a.md")).toBe(true);
    for (const code of ["relations.requires.self", "relations.requires.missing", "relations.requires.invalid-path"]) {
      expect(loaded.model.issues.some((issue) => issue.code === code && issue.path === "guides/a.md")).toBe(true);
    }
    expect(loaded.model.relations.get("decisions/new.md")!.supersedes).toEqual(["decisions/old.md"]);
    expect(loaded.model.supersededBy.get("decisions/old.md")).toEqual(["decisions/new.md"]);
    expect(loaded.validity.byId.get("decisions/new.md")!.status).toBe("current");

    const viewer = projectKnowledgeViewerState(loaded);
    const requiresEdges = viewer.edges
      .filter((edge) => edge.from === "guides/a.md" && edge.type === "requires")
      .map((edge) => edge.to)
      .sort();
    expect(requiresEdges).toEqual(["guides/b.md", "refs/api.md"]);
    expect(viewer.edges.some((edge) => edge.to === "guides/missing.md")).toBe(false);
    expect(viewer.edges.some((edge) => edge.from === "guides/a.md" && edge.to === "guides/a.md")).toBe(false);
    expect(
      viewer.edges
        .filter((edge) => edge.from === "decisions/new.md" && edge.type === "supersedes")
        .map((edge) => edge.to)
    ).toEqual(["decisions/old.md"]);

    await withRegistryDir(fixture.registryDir, async () => {
      const index = JSON.parse((await runCli(["--json", "index", "--source", fixture.source], fixture.base)).stdout) as {
        documents: Array<{ id: string; requires: string[] }>;
      };
      expect(index.documents.find((document) => document.id === "guides/a.md")!.requires).toEqual([
        "guides/b.md",
        "refs/api.md"
      ]);

      const tree = JSON.parse((await runCli(["--json", "tree", "--source", fixture.source], fixture.base)).stdout) as {
        topics: Array<{ documents: Array<{ id: string; requires: string[] }> }>;
      };
      const flatTreeDocs = tree.topics.flatMap((topic) => topic.documents);
      expect(flatTreeDocs.find((document) => document.id === "guides/a.md")!.requires).toEqual([
        "guides/b.md",
        "refs/api.md"
      ]);

      const show = JSON.parse(
        (await runCli(["--json", "show", "guides/a.md", "--source", fixture.source], fixture.base)).stdout
      ) as { documents: Array<{ frontmatter: { relations?: { requires?: string[] } } }> };
      expect(show.documents[0]!.frontmatter.relations?.requires).toEqual(["guides/b.md", "refs/api.md"]);

      const search = JSON.parse(
        (await runCli(["--json", "search", "New", "--source", fixture.source], fixture.base)).stdout
      ) as { results: Array<{ id: string; supersedes: string[] }> };
      const newResult = search.results.find((result) => result.id === "decisions/new.md");
      expect(newResult).toBeTruthy();
      expect(newResult!.supersedes).toEqual(["decisions/old.md"]);

      const context = JSON.parse(
        (await runCli(["--json", "context", "--files", "src/api/retry.ts", "--source", fixture.source], fixture.base)).stdout
      ) as { prerequisites: Array<{ id: string }> };
      const prerequisiteIds = context.prerequisites.map((entry) => entry.id);
      expect(prerequisiteIds).toContain("guides/b.md");
      expect(prerequisiteIds).not.toContain("guides/a.md");
      expect(prerequisiteIds).not.toContain("guides/missing.md");
    });
  });
});

describe("R2-4 CLI help", () => {
  it("advertises only the current protocol and no removed tree --docs", () => {
    const cliRoot = path.resolve(__dirname, "..");
    const bin = path.join(cliRoot, "dist", "bin", "llmdoc.js");
    const result = spawnSync(process.execPath, [bin, "--help"], { cwd: cliRoot, encoding: "utf8" });
    expect(result.status).toBe(0);
    const help = result.stdout;
    expect(help).toContain("Usage: llmdoc");
    expect(help).toContain("llmdoc tree");
    expect(help).not.toContain("--docs");
  });
});
