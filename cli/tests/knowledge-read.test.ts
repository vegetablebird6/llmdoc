import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { contentDigest } from "../src/lib/knowledge/document.js";
import { loadKnowledgeForRead } from "../src/lib/knowledge/read.js";
import { searchKnowledge } from "../src/lib/knowledge/search.js";
import { projectKnowledgeViewerState } from "../src/lib/knowledge/viewer-state.js";
import { initKnowledgeRepository } from "../src/lib/knowledge/init.js";
import { expectKnowledgeError } from "./knowledge-helpers.js";
import { commitFile, git, head, initRepo, makeTempDir, realPath, snapshotWorktree, sourceIndexBytes, writeFile } from "./knowledge-helpers.js";

const createdDirs: string[] = [];

function defaultRegistryFile(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? "", "llmdoc", "bindings.json");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "llmdoc", "bindings.json");
}

function defaultRegistryState(): { exists: boolean; digest: string | null } {
  const filePath = defaultRegistryFile();
  if (!fs.existsSync(filePath)) {
    return { exists: false, digest: null };
  }
  return { exists: true, digest: createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") };
}

let realRegistryBefore: { exists: boolean; digest: string | null };

beforeAll(() => {
  realRegistryBefore = defaultRegistryState();
});

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort temp cleanup
    }
  }
  expect(defaultRegistryState()).toEqual(realRegistryBefore);
});

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

function kdoc(kind: string, description: string, body?: string, requires?: string[]): string {
  const lines = ["---", `description: ${description}`, `kind: ${kind}`, "source:", "  paths:", "    - src/api/retry.ts"];
  if (requires) {
    lines.push("relations:", "  requires:");
    for (const target of requires) {
      lines.push(`    - ${target}`);
    }
  }
  lines.push("---", "", body ?? `# ${description}`);
  return `${lines.join("\n")}\n`;
}

interface Fixture {
  base: string;
  registryDir: string;
  source: string;
  knowledge: string;
  repositoryId: string;
  sourceHead: string;
}

async function setupKnowledge(
  prefix: string,
  files: Record<string, string>,
  requiresMap: Record<string, string[]> = {}
): Promise<Fixture> {
  const base = makeTempDir(prefix);
  createdDirs.push(base);
  const registryDir = `${base}/config/llmdoc`;
  const source = initRepo(`${base}/source`);
  commitFile(source, "src/api/retry.ts", "export const retry = true;\n", "init");
  const sourceHead = head(source);
  const init = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });
  const knowledge = init.knowledgeRoot;
  for (const [id, raw] of Object.entries(files)) {
    writeFile(knowledge, `docs/${id}`, raw);
  }
  writeFile(
    knowledge,
    "inbox/candidate.md",
    kdoc("guide", "Candidate retry idea", "# Candidate\n\nsecret-inbox-token")
  );
  writeFile(knowledge, ".llmdoc-cache/index.json", "{\"cache\":true,\"secret-cache-token\":true}\n");
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
  writeFile(
    knowledge,
    ".llmdoc/meta.json",
    `${JSON.stringify(
      {
        schema: "llmdoc.meta/v3-ng",
        source: { repositoryId: init.repositoryId, lastGlobalReviewRevision: sourceHead },
        documents
      },
      null,
      2
    )}\n`
  );
  git(knowledge, ["add", "-A"]);
  git(knowledge, ["commit", "-m", "docs: seed knowledge"]);
  return { base, registryDir, source: realPath(source), knowledge, repositoryId: init.repositoryId, sourceHead };
}

const BASE_DOCS: Record<string, string> = {
  "architecture.md": kdoc("architecture", "Overall architecture", "# Architecture\n\nretry architecture; see [recovery](lifecycle/task-recovery.md)"),
  "lifecycle/task-recovery.md": kdoc("guide", "Task recovery", "# Recovery\n\nretry recovery"),
  "decisions/retry.md": kdoc("decision", "Retry decision", "# Decision\n\nretry decision"),
  "reference/api.md": kdoc("reference", "API reference", "# API\n\nretry reference")
};

describe("knowledge read resolution", () => {
  it("reads committed docs from the fixed knowledge HEAD at any depth and excludes inbox/cache", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-", BASE_DOCS);
    const committedKnowledge = head(fixture.knowledge);
    writeFile(fixture.knowledge, "llmdoc.yaml", "schema: broken\n");
    writeFile(fixture.knowledge, ".llmdoc/meta.json", "{}\n");
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });

    expect(loaded.mode).toBe("bound");
    expect(loaded.repositoryId).toBe(fixture.repositoryId);
    expect(loaded.knowledgeRevision).toBe(committedKnowledge);
    expect(loaded.model.documents.map((document) => document.id)).toEqual([
      "architecture.md",
      "decisions/retry.md",
      "lifecycle/task-recovery.md",
      "reference/api.md"
    ]);
    expect(loaded.model.byId.has("inbox/candidate.md")).toBe(false);
    expect(loaded.model.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    for (const document of loaded.model.documents) {
      expect(loaded.validity.byId.get(document.id)!.status).toBe("current");
    }
  });

  it("does not treat an uncommitted working-tree edit as formal knowledge", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-draft-", BASE_DOCS);
    writeFile(fixture.knowledge, "docs/drafts/uncommitted.md", kdoc("guide", "Draft only", "# Draft"));
    fs.appendFileSync(path.join(fixture.knowledge, "docs", "architecture.md"), "\n\nuncommitted edit\n");

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.model.byId.has("drafts/uncommitted.md")).toBe(false);
    expect(loaded.validity.byId.get("architecture.md")!.status).toBe("current");
  });

  it("surfaces committed digest tampering as needs_review", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-tamper-", BASE_DOCS);
    writeFile(fixture.knowledge, "docs/architecture.md", kdoc("architecture", "Overall architecture", "# Architecture\n\nedited after validation"));
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "edit architecture"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.validity.byId.get("architecture.md")!.status).toBe("needs_review");
    expect(loaded.validity.byId.get("architecture.md")!.reasons.join(" ")).toContain("digest mismatch");
  });

  it("propagates unavailable source history through the viewer projection", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-history-", BASE_DOCS);
    const metaPath = path.join(fixture.knowledge, ".llmdoc", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      documents: Record<string, { validatedSourceRevision: string }>;
    };
    for (const evidence of Object.values(meta.documents)) {
      evidence.validatedSourceRevision = "f".repeat(40);
    }
    writeFile(fixture.knowledge, ".llmdoc/meta.json", `${JSON.stringify(meta, null, 2)}\n`);
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "point evidence at unavailable history"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    const viewer = projectKnowledgeViewerState(loaded);
    expect(viewer.historyAvailable).toBe(false);
    expect(viewer.sourceBlockers.some((blocker) => blocker.code === "history_unavailable")).toBe(true);
    expect(viewer.nodes.every((node) => node.status === "needs_review")).toBe(true);
  });

  it("rejects committed config and meta identities that disagree", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-identity-", BASE_DOCS);
    const metaPath = path.join(fixture.knowledge, ".llmdoc", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { source: { repositoryId: string } };
    meta.source.repositoryId = `llmdoc-${"f".repeat(32)}`;
    writeFile(fixture.knowledge, ".llmdoc/meta.json", `${JSON.stringify(meta, null, 2)}\n`);
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "mismatch identities"]);

    await expectKnowledgeError(
      () => loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir }),
      "E_SOURCE_IDENTITY_MISMATCH"
    );
  });

  it("treats a committed invalid evidence ledger as unverified", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-invalid-meta-", BASE_DOCS);
    const meta = JSON.parse(fs.readFileSync(path.join(fixture.knowledge, ".llmdoc", "meta.json"), "utf8")) as {
      documents: Record<string, { validatedSourceRevision: string | null }>;
    };
    meta.documents["architecture.md"]!.validatedSourceRevision = null;
    writeFile(fixture.knowledge, ".llmdoc/meta.json", `${JSON.stringify(meta, null, 2)}\n`);
    git(fixture.knowledge, ["add", "-A"]);
    git(fixture.knowledge, ["commit", "-m", "invalid evidence"]);

    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    expect(loaded.meta).toBeNull();
    expect(loaded.issues.some((issue) => issue.code === "meta.invalid")).toBe(true);
    expect(loaded.validity.byId.get("architecture.md")!.status).toBe("unverified");
  });

  it("excludes candidates and cache from formal search and annotates source and status", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-search-", BASE_DOCS);
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });

    const response = searchKnowledge({ model: loaded.model, validity: loaded.validity, query: "retry" });
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.every((result) => !result.id.startsWith("inbox/"))).toBe(true);
    expect(response.results.every((result) => result.status === "current")).toBe(true);

    const candidateOnly = searchKnowledge({ model: loaded.model, validity: loaded.validity, query: "secret-inbox-token" });
    expect(candidateOnly.results).toEqual([]);
    const cacheOnly = searchKnowledge({ model: loaded.model, validity: loaded.validity, query: "secret-cache-token" });
    expect(cacheOnly.results).toEqual([]);
  });

  it("rejects an unbound source instead of falling back to the source Git", async () => {
    const base = makeTempDir("llmdoc-knowledge-read-nb-");
    createdDirs.push(base);
    const registryDir = `${base}/registry`;
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    await expectKnowledgeError(() => loadKnowledgeForRead({ sourceInput: source, registryDir }), "E_BINDING_NOT_FOUND");
  });

  it("reads an explicit no-Git directory as unbound content without claiming a revision", async () => {
    const base = makeTempDir("llmdoc-knowledge-read-unbound-");
    createdDirs.push(base);
    const dir = `${base}/plain-knowledge`;
    writeFile(dir, "docs/guides/g.md", kdoc("guide", "Plain guide", "# Plain\n\nunbound retry"));
    const loaded = await loadKnowledgeForRead({ knowledgeInput: dir });

    expect(loaded.mode).toBe("unbound");
    expect(loaded.repositoryId).toBeNull();
    expect(loaded.knowledgeRevision).toBeNull();
    expect(loaded.validity.sourceRevision).toBeNull();
    expect(loaded.model.documents.map((document) => document.id)).toEqual(["guides/g.md"]);
    expect(loaded.validity.byId.get("guides/g.md")!.status).toBe("unverified");
    const response = searchKnowledge({ model: loaded.model, validity: loaded.validity, query: "unbound" });
    expect(response.results.map((result) => result.id)).toEqual(["guides/g.md"]);
  });

  it("preserves the source repository byte-identically across reads", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-frozen-", BASE_DOCS);
    const headBefore = head(fixture.source);
    const indexBefore = sourceIndexBytes(fixture.source);
    const filesBefore = snapshotWorktree(fixture.source);

    for (let i = 0; i < 2; i += 1) {
      const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
      searchKnowledge({ model: loaded.model, validity: loaded.validity, query: "retry" });
    }

    expect(head(fixture.source)).toBe(headBefore);
    expect(sourceIndexBytes(fixture.source).equals(indexBefore)).toBe(true);
    expect(snapshotWorktree(fixture.source)).toEqual(filesBefore);
  });

  it("includes the requires closure in context mapping and marks unbound files", async () => {
    const fixture = await setupKnowledge(
      "llmdoc-knowledge-read-ctx-",
      {
        "guides/a.md": kdoc("guide", "A", "# A\n\nuses retry", ["reference/b.md"]),
        "reference/b.md": kdoc("reference", "B", "# B\n\nretry base")
      },
      { "guides/a.md": ["reference/b.md"] }
    );
    const result = await runCli(["--json", "context", "--files", "src/api/retry.ts", "src/api/new.ts", "--knowledge", fixture.knowledge], fixture.base);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      schema: string;
      mode: string;
      impacted: Array<{ id: string }>;
      prerequisites: Array<{ id: string }>;
      unmappedFiles: string[];
    };
    expect(payload.schema).toBe("llmdoc.context/v1");
    expect(payload.impacted.map((entry) => entry.id)).toEqual(["guides/a.md", "reference/b.md"]);
    expect(payload.prerequisites.map((entry) => entry.id)).toEqual(["reference/b.md"]);
    expect(payload.unmappedFiles).toEqual(["src/api/new.ts"]);
  });
});

describe("knowledge read CLI surface", () => {
  it("uses a bound cwd for bare commands and never exposes source-side legacy documents", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-cwd-", BASE_DOCS);
    commitFile(
      fixture.source,
      "llmdoc/legacy.mdx",
      "---\ndescription: legacy-source-token\nkind: guide\n---\n\n# legacy-source-token\n",
      "legacy source file"
    );
    await withRegistryDir(fixture.registryDir, async () => {
      const index = await runCli(["--json", "index"], fixture.source);
      expect(index.exitCode).toBe(0);
      expect((JSON.parse(index.stdout) as { mode: string }).mode).toBe("bound");

      const search = await runCli(["--json", "search", "legacy-source-token"], fixture.source);
      expect((JSON.parse(search.stdout) as { results: unknown[] }).results).toEqual([]);
      const show = await runCli(["--json", "show", "llmdoc/legacy.mdx"], fixture.source);
      expect(show.exitCode).toBe(2);
      expect((JSON.parse(show.stdout) as { error: { code: string } }).error.code).toBe("E_KNOWLEDGE_DOC_NOT_FOUND");
    });
  });

  it("never claims current for an explicit source and knowledge pair without a precise binding", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-unassociated-", BASE_DOCS);
    const loaded = await loadKnowledgeForRead({
      sourceInput: fixture.source,
      knowledgeInput: fixture.knowledge,
      registryDir: `${fixture.base}/unused-registry`
    });
    expect(loaded.mode).toBe("explicit");
    expect(loaded.identityVerified).toBe(false);
    expect(loaded.validity.byId.get("architecture.md")!.status).not.toBe("current");
    expect(loaded.validity.byId.get("architecture.md")!.reasons.join(" ")).toContain("No provable source/knowledge identity association");
  });

  it("validates every knowledge read command's JSON output against its schema", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-cli-", BASE_DOCS);
    const commands: Array<[string, string[]]> = [
      ["search", ["--json", "search", "retry", "--knowledge", fixture.knowledge]],
      ["index", ["--json", "index", "--knowledge", fixture.knowledge]],
      ["tree", ["--json", "tree", "--knowledge", fixture.knowledge]],
      ["show", ["--json", "show", "architecture.md", "--knowledge", fixture.knowledge]],
      ["context", ["--json", "context", "--files", "src/api/retry.ts", "--knowledge", fixture.knowledge]]
    ];
    for (const [, argv] of commands) {
      const result = await runCli(argv, fixture.base);
      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }

    const search = JSON.parse((await runCli(["--json", "search", "retry", "--knowledge", fixture.knowledge], fixture.base)).stdout) as {
      schema: string;
      mode: string;
      unbound: boolean;
      results: Array<{ id: string; kind: string; status: string }>;
    };
    expect(search.schema).toBe("llmdoc.search/v1");
    expect(search.mode).toBe("explicit");
    expect(search.unbound).toBe(false);
    expect(search.results.every((entry) => entry.id !== "inbox/candidate.md")).toBe(true);
  });

  it("reads through an explicit bound --source using the user registry", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-bindsrc-", BASE_DOCS);
    const result = await withRegistryDir(fixture.registryDir, () =>
      runCli(["--json", "search", "retry", "--source", fixture.source], fixture.base)
    );
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { mode: string; repositoryId: string; results: Array<{ id: string }> };
    expect(payload.mode).toBe("bound");
    expect(payload.repositoryId).toBe(fixture.repositoryId);
    expect(payload.results.some((entry) => entry.id === "reference/api.md")).toBe(true);
  });

  it("keeps the viewer projection consistent with the read model and CLI statuses", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-viewer-", BASE_DOCS);
    const loaded = await loadKnowledgeForRead({ sourceInput: fixture.source, registryDir: fixture.registryDir });
    const viewer = projectKnowledgeViewerState(loaded);
    const index = JSON.parse(
      (
        await withRegistryDir(fixture.registryDir, () =>
          runCli(["--json", "index", "--source", fixture.source], fixture.base)
        )
      ).stdout
    ) as { documents: Array<{ id: string; status: string }> };

    expect(viewer.nodes.map((node) => node.id)).toEqual(index.documents.map((entry) => entry.id));
    expect(viewer.nodes.map((node) => node.status)).toEqual(index.documents.map((entry) => entry.status));
    expect(viewer.edges.some((edge) => edge.type === "link")).toBe(true);
  });

  it("emits structured KnowledgeError JSON with exit 2 for invalid knowledge read inputs", async () => {
    const fixture = await setupKnowledge("llmdoc-knowledge-read-err-", BASE_DOCS);

    const escape = await runCli(["--json", "context", "--files", "../outside.ts", "--knowledge", fixture.knowledge], fixture.base);
    expect(escape.exitCode).toBe(2);
    expect((JSON.parse(escape.stdout) as { error: { code: string } }).error.code).toBe("E_INVALID_SOURCE_FILE");

    const badKind = await runCli(["--json", "index", "--kind", "bogus", "--knowledge", fixture.knowledge], fixture.base);
    expect(badKind.exitCode).toBe(2);
    expect((JSON.parse(badKind.stdout) as { error: { code: string } }).error.code).toBe("E_INVALID_KIND");

    const missingDoc = await runCli(["--json", "show", "nope.md", "--knowledge", fixture.knowledge], fixture.base);
    expect(missingDoc.exitCode).toBe(2);
    expect((JSON.parse(missingDoc.stdout) as { error: { code: string } }).error.code).toBe("E_KNOWLEDGE_DOC_NOT_FOUND");
  });

  it("renders a stable KnowledgeError when an explicit knowledge root does not exist", async () => {
    const base = makeTempDir("llmdoc-knowledge-read-miss-");
    createdDirs.push(base);
    const result = await runCli(["--json", "index", "--knowledge", `${base}/nope`], base);
    expect(result.exitCode).toBe(2);
    const payload = JSON.parse(result.stdout) as { error: { code: string } };
    expect(payload.error.code).toBe("E_KNOWLEDGE_REPO_NOT_FOUND");
  });
});
