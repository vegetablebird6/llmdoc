import fs from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { contentDigest, normalizeKnowledgeContent } from "../src/lib/knowledge/document.js";
import { buildKnowledgeModelFromRaw, type KnowledgeRawEntry } from "../src/lib/knowledge/knowledge-model.js";
import { validateKnowledgeMeta, type KnowledgeMeta } from "../src/lib/knowledge/meta.js";
import { computeValidity } from "../src/lib/knowledge/validity.js";
import { resolveSourceContext } from "../src/lib/knowledge/contexts.js";
import { commitFile, git, head, initRepo, makeTempDir, realPath, writeFile } from "./knowledge-helpers.js";

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

function modelFrom(files: Record<string, string>) {
  const entries: KnowledgeRawEntry[] = Object.entries(files).map(([id, raw]) => ({
    id,
    raw,
    absolutePath: `/virtual/docs/${id}`
  }));
  return buildKnowledgeModelFromRaw(entries, "/virtual/docs");
}

function doc(options: {
  kind: string;
  description?: string;
  source?: string[];
  requires?: string[];
  related?: string[];
  supersedes?: string[];
  body?: string;
}): string {
  const lines = ["---", `description: ${options.description ?? "desc"}`, `kind: ${options.kind}`];
  lines.push("source:");
  lines.push("  paths:");
  for (const path of options.source ?? ["src/api/retry.ts"]) {
    lines.push(`    - ${path}`);
  }
  if (options.requires || options.related || options.supersedes) {
    lines.push("relations:");
    for (const key of ["requires", "related", "supersedes"] as const) {
      const values = options[key];
      if (values) {
        lines.push(`  ${key}:`);
        for (const value of values) {
          lines.push(`    - ${value}`);
        }
      }
    }
  }
  lines.push("---", "", options.body ?? `# ${options.description ?? "Doc"}`);
  return `${lines.join("\n")}\n`;
}

async function makeSource(prefix: string): Promise<string> {
  const base = makeTempDir(prefix);
  createdDirs.push(base);
  const source = initRepo(`${base}/source`);
  commitFile(source, "src/api/retry.ts", "export const retry = true;\n", "init");
  return realPath(source);
}

function metaFor(input: {
  repositoryId: string;
  documents: Record<string, { revision: string | null; digest: string | null; paths?: string[]; requires?: Record<string, string> }>;
}): KnowledgeMeta {
  return validateKnowledgeMeta(
    {
      schema: "llmdoc.meta/v3-ng",
      source: { repositoryId: input.repositoryId, lastGlobalReviewRevision: null },
      documents: Object.fromEntries(
        Object.entries(input.documents).map(([id, evidence]) => [
          id,
          {
            validatedSourceRevision: evidence.revision,
            validatedContentDigest: evidence.digest,
            validatedSourcePaths: evidence.paths ?? [],
            validatedRequires: evidence.requires ?? {}
          }
        ])
      )
    },
    "/virtual/meta.json"
  );
}

const REPOSITORY_ID = `llmdoc-${"a".repeat(32)}`;

describe("knowledge document model", () => {
  it("parses all four kinds at any docs depth and derives topics from the first segment", () => {
    const model = modelFrom({
      "architecture.md": doc({ kind: "architecture", description: "Arch" }),
      "lifecycle/task-recovery.md": doc({ kind: "guide", description: "Recovery" }),
      "lifecycle/deep/nested/note.md": doc({ kind: "reference", description: "Deep" }),
      "decisions/old.md": doc({ kind: "decision", description: "Old" })
    });
    expect(model.documents.map((entry) => entry.id)).toEqual([
      "architecture.md",
      "decisions/old.md",
      "lifecycle/deep/nested/note.md",
      "lifecycle/task-recovery.md"
    ]);
    expect(model.byId.get("lifecycle/deep/nested/note.md")!.topic).toBe("lifecycle");
    expect(model.byId.get("architecture.md")!.topic).toBeNull();
    expect(model.rootSingletons.map((entry) => entry.id)).toEqual(["architecture.md"]);
  });

  it("normalizes CRLF before digesting so line endings do not drift", () => {
    const lf = "---\ndescription: d\nkind: guide\nsource:\n  paths:\n    - src/a.ts\n---\n\n# T\n";
    const crlf = lf.replaceAll("\n", "\r\n");
    expect(normalizeKnowledgeContent(crlf)).toBe(lf);
    expect(contentDigest(crlf)).toBe(contentDigest(lf));
  });

  it("rejects a document without source.paths as a structural issue", () => {
    const model = modelFrom({
      "bad.md": "---\ndescription: d\nkind: guide\n---\n\n# Bad\n"
    });
    expect(model.documents).toHaveLength(0);
    expect(model.issues.some((issue) => issue.code === "document.invalid")).toBe(true);
  });

  it("detects requires cycles and supersedes target/type violations", () => {
    const cyclic = modelFrom({
      "a.md": doc({ kind: "guide", requires: ["b.md"] }),
      "b.md": doc({ kind: "guide", requires: ["a.md"] })
    });
    expect(cyclic.cyclicIds.has("a.md")).toBe(true);
    expect(cyclic.issues.some((issue) => issue.code === "relations.requires.cycle")).toBe(true);

    const filtered = modelFrom({
      "guides/a.md": doc({ kind: "guide", requires: ["guides/b.md", "guides/a.md", "guides/missing.md", "../evil.md", "refs\\api.md"] }),
      "guides/b.md": doc({ kind: "guide" }),
      "refs/api.md": doc({ kind: "reference" })
    });
    expect(filtered.relations.get("guides/a.md")!.requires).toEqual(["guides/b.md", "refs/api.md"]);
    expect(filtered.requiresProblems.has("guides/a.md")).toBe(true);
    for (const code of ["relations.requires.self", "relations.requires.missing", "relations.requires.invalid-path"]) {
      expect(filtered.issues.some((issue) => issue.code === code && issue.path === "guides/a.md")).toBe(true);
    }

    const badSupersedes = modelFrom({
      "new.md": doc({ kind: "decision", supersedes: ["guide.md"] }),
      "guide.md": doc({ kind: "guide" })
    });
    expect(badSupersedes.issues.some((issue) => issue.code === "relations.supersedes.target-kind")).toBe(true);

    const selfSupersede = modelFrom({ "d.md": doc({ kind: "decision", supersedes: ["d.md"] }) });
    expect(selfSupersede.issues.some((issue) => issue.code === "relations.supersedes.self")).toBe(true);
  });

  it("annotates supersedes and reports missing body links", () => {
    const model = modelFrom({
      "decisions/old.md": doc({ kind: "decision", description: "Old" }),
      "decisions/new.md": doc({ kind: "decision", description: "New", supersedes: ["decisions/old.md", "decisions/missing.md", "decisions/new.md"] }),
      "guides/g.md": doc({ kind: "guide", body: "# G\n\nsee [gone](./missing.md)" })
    });
    expect(model.supersededBy.get("decisions/old.md")).toEqual(["decisions/new.md"]);
    expect(model.relations.get("decisions/new.md")!.supersedes).toEqual(["decisions/old.md"]);
    expect(model.issues.some((issue) => issue.code === "relations.supersedes.missing")).toBe(true);
    expect(model.issues.some((issue) => issue.code === "relations.supersedes.self")).toBe(true);
    expect(model.issues.some((issue) => issue.code === "link.missing" && issue.path === "guides/g.md")).toBe(true);
  });
});

describe("knowledge validity projection", () => {
  it("marks documents unverified without evidence and current when all four evidence match", async () => {
    const source = await makeSource("llmdoc-knowledge-valid-");
    const sourceContext = await resolveSourceContext(source);
    const revision = sourceContext.headRevision!;
    const model = modelFrom({ "guides/g.md": doc({ kind: "guide", description: "G" }) });
    const document = model.byId.get("guides/g.md")!;

    const unverified = await computeValidity({ model, meta: null, source: sourceContext, identityVerified: false, knowledgeRevision: null });
    expect(unverified.byId.get("guides/g.md")!.status).toBe("unverified");

    const meta = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: {
        "guides/g.md": {
          revision,
          digest: document.contentDigest,
          paths: ["src/api/retry.ts"],
          requires: {}
        }
      }
    });
    const current = await computeValidity({ model, meta, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(current.byId.get("guides/g.md")!.status).toBe("current");
    expect(current.sourceRevision).toBe(revision);
  });

  it("flags ordinary content edits through digest mismatch", async () => {
    const source = await makeSource("llmdoc-knowledge-tamper-");
    const sourceContext = await resolveSourceContext(source);
    const original = modelFrom({ "guides/g.md": doc({ kind: "guide", description: "G" }) }).byId.get("guides/g.md")!;
    const meta = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: { "guides/g.md": { revision: sourceContext.headRevision, digest: original.contentDigest, paths: ["src/api/retry.ts"] } }
    });

    const edited = modelFrom({ "guides/g.md": doc({ kind: "guide", description: "G", body: "# G\n\nedited" }) });
    const projection = await computeValidity({ model: edited, meta, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(projection.byId.get("guides/g.md")!.status).toBe("needs_review");
    expect(projection.byId.get("guides/g.md")!.reasons.join(" ")).toContain("digest mismatch");
  });

  it("keeps a dependent needs_review when its requires target changes, even after the target re-seals", async () => {
    const source = await makeSource("llmdoc-knowledge-dep-");
    const sourceContext = await resolveSourceContext(source);
    const revision = sourceContext.headRevision!;
    const model = modelFrom({
      "guides/a.md": doc({ kind: "guide", description: "A", requires: ["./guides/b.md"] }),
      "guides/b.md": doc({ kind: "guide", description: "B" })
    });
    const b1 = model.byId.get("guides/b.md")!;
    const a = model.byId.get("guides/a.md")!;
    const baseMeta = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: {
        "guides/a.md": { revision, digest: a.contentDigest, paths: ["src/api/retry.ts"], requires: { "guides/b.md": b1.contentDigest } },
        "guides/b.md": { revision, digest: b1.contentDigest, paths: ["src/api/retry.ts"] }
      }
    });
    const initial = await computeValidity({ model, meta: baseMeta, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(initial.byId.get("guides/a.md")!.status).toBe("current");

    const changed = modelFrom({
      "guides/a.md": doc({ kind: "guide", description: "A", requires: ["./guides/b.md"] }),
      "guides/b.md": doc({ kind: "guide", description: "B", body: "# B\n\nchanged" })
    });
    const changedProjection = await computeValidity({ model: changed, meta: baseMeta, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(changedProjection.byId.get("guides/a.md")!.status).toBe("needs_review");
    expect(changedProjection.byId.get("guides/b.md")!.status).toBe("needs_review");

    // B re-seals to current, but A still records the old digest and stays needs_review.
    const b2 = changed.byId.get("guides/b.md")!;
    const resealedMeta = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: {
        "guides/a.md": { revision, digest: a.contentDigest, paths: ["src/api/retry.ts"], requires: { "guides/b.md": b1.contentDigest } },
        "guides/b.md": { revision, digest: b2.contentDigest, paths: ["src/api/retry.ts"] }
      }
    });
    const resealed = await computeValidity({ model: changed, meta: resealedMeta, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(resealed.byId.get("guides/b.md")!.status).toBe("current");
    expect(resealed.byId.get("guides/a.md")!.status).toBe("needs_review");
    expect(resealed.byId.get("guides/a.md")!.reasons.join(" ")).toContain("digest changed");
  });

  it("degrades to needs_review when the validated source revision is missing or the scope changed", async () => {
    const source = await makeSource("llmdoc-knowledge-rev-");
    const sourceContext = await resolveSourceContext(source);
    const model = modelFrom({ "guides/g.md": doc({ kind: "guide", description: "G" }) });
    const document = model.byId.get("guides/g.md")!;

    const missingRevision = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: { "guides/g.md": { revision: "f".repeat(40), digest: document.contentDigest, paths: ["src/api/retry.ts"] } }
    });
    const projection = await computeValidity({ model, meta: missingRevision, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(projection.byId.get("guides/g.md")!.status).toBe("needs_review");
    expect(projection.byId.get("guides/g.md")!.reasons.join(" ")).toContain("not available in history");
    expect(projection.historyAvailable).toBe(false);
    expect(projection.sourceBlockers.some((blocker) => blocker.code === "history_unavailable")).toBe(true);

    const edited = modelFrom({ "guides/g.md": doc({ kind: "guide", description: "G", body: "# G\n\nedited" }) });
    const stale = await computeValidity({ model: edited, meta: missingRevision, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(stale.byId.get("guides/g.md")!.reasons.join(" ")).toContain("digest mismatch");
    expect(stale.sourceBlockers.some((blocker) => blocker.code === "history_unavailable")).toBe(true);

    const scopeChanged = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: { "guides/g.md": { revision: sourceContext.headRevision, digest: document.contentDigest, paths: ["src/other.ts"] } }
    });
    const scopeProjection = await computeValidity({ model, meta: scopeChanged, source: sourceContext, identityVerified: true, knowledgeRevision: sourceContext.headRevision });
    expect(scopeProjection.byId.get("guides/g.md")!.reasons.join(" ")).toContain("Source scope changed");
  });

  it("never treats source paths absent from the committed snapshot as current", async () => {
    const source = await makeSource("llmdoc-knowledge-source-evidence-");
    writeFile(source, "src/live/untracked.ts", "export const live = true;\n");
    const sourceContext = await resolveSourceContext(source);
    const model = modelFrom({
      "missing.md": doc({ kind: "guide", source: ["src/missing.ts"] }),
      "empty-glob.md": doc({ kind: "guide", source: ["src/**/*.tsx"] }),
      "live-glob.md": doc({ kind: "guide", source: ["src/live/**"] }),
      "matched.md": doc({ kind: "guide", source: ["src/**/*.ts"] })
    });
    const revision = sourceContext.headRevision!;
    const meta = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: Object.fromEntries(
        model.documents.map((document) => [document.id, {
          revision,
          digest: document.contentDigest,
          paths: document.frontmatter.source.paths
        }])
      )
    });

    const projection = await computeValidity({ model, meta, source: sourceContext, identityVerified: true, knowledgeRevision: revision });
    expect(projection.byId.get("matched.md")!.status).toBe("current");
    for (const id of ["missing.md", "empty-glob.md", "live-glob.md"]) {
      expect(projection.byId.get(id)!.status).toBe("needs_review");
    }
  });

  it("reports diverged when the validated source revision is not an ancestor of HEAD", async () => {
    const source = await makeSource("llmdoc-knowledge-diverged-");
    const baseRevision = head(source);
    commitFile(source, "src/side.ts", "export const side = true;\n", "side");
    const sideRevision = head(source);
    git(source, ["reset", "--hard", baseRevision]);
    const sourceContext = await resolveSourceContext(source);
    const model = modelFrom({ "guides/g.md": doc({ kind: "guide", description: "G" }) });
    const meta = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: { "guides/g.md": { revision: sideRevision, digest: model.byId.get("guides/g.md")!.contentDigest, paths: ["src/api/retry.ts"] } }
    });

    const projection = await computeValidity({ model, meta, source: sourceContext, identityVerified: true, knowledgeRevision: baseRevision });
    expect(projection.byId.get("guides/g.md")!.status).toBe("needs_review");
    expect(projection.byId.get("guides/g.md")!.reasons.join(" ")).toContain("not an ancestor");
    expect(projection.historyAvailable).toBe(false);
    expect(projection.sourceBlockers.some((blocker) => blocker.code === "diverged")).toBe(true);
  });

  it("keeps supersedes cycles out of dependency validity", async () => {
    const source = await makeSource("llmdoc-knowledge-supersedes-cycle-");
    const sourceContext = await resolveSourceContext(source);
    const model = modelFrom({
      "old.md": doc({ kind: "decision", supersedes: ["new.md"] }),
      "new.md": doc({ kind: "decision", supersedes: ["old.md"] })
    });
    const revision = sourceContext.headRevision!;
    const meta = metaFor({
      repositoryId: REPOSITORY_ID,
      documents: Object.fromEntries(model.documents.map((document) => [document.id, { revision, digest: document.contentDigest, paths: ["src/api/retry.ts"] }]))
    });
    const projection = await computeValidity({ model, meta, source: sourceContext, identityVerified: true, knowledgeRevision: revision });
    expect(model.issues.some((issue) => issue.code === "relations.supersedes.cycle")).toBe(true);
    expect(model.cyclicIds.size).toBe(0);
    expect([...projection.byId.values()].every((entry) => entry.status === "current")).toBe(true);
  });

  it("rejects malformed meta ledgers instead of trusting them", () => {
    expect(() =>
      validateKnowledgeMeta({ schema: "llmdoc.meta/v3", source: {}, documents: {} }, "/virtual/meta.json")
    ).toThrow(/schema must be/);
    expect(() =>
      validateKnowledgeMeta(
        {
          schema: "llmdoc.meta/v3-ng",
          source: { repositoryId: REPOSITORY_ID, lastGlobalReviewRevision: null },
          documents: { "g.md": { validatedSourceRevision: null, validatedContentDigest: "sha256:xyz", validatedSourcePaths: [], validatedRequires: {} } }
        },
        "/virtual/meta.json"
      )
    ).toThrow(/sha256/);
  });

  it.each([
    ["partial evidence", "a.md", { validatedSourceRevision: null, validatedContentDigest: null, validatedSourcePaths: ["src/a.ts"], validatedRequires: {} }, /partial validation evidence/],
    ["digest without revision", "a.md", { validatedSourceRevision: null, validatedContentDigest: `sha256:${"a".repeat(64)}`, validatedSourcePaths: ["src/a.ts"], validatedRequires: {} }, /no validated source revision/],
    ["non-canonical id", "../evil.md", { validatedSourceRevision: null, validatedContentDigest: null, validatedSourcePaths: [], validatedRequires: {} }, /canonical docs-relative/],
    ["short revision", "a.md", { validatedSourceRevision: "abc123", validatedContentDigest: `sha256:${"a".repeat(64)}`, validatedSourcePaths: ["src/a.ts"], validatedRequires: {} }, /full commit OID/]
  ])("rejects %s", (_name, id, evidence, message) => {
    expect(() => validateKnowledgeMeta({
      schema: "llmdoc.meta/v3-ng",
      source: { repositoryId: REPOSITORY_ID, lastGlobalReviewRevision: null },
      documents: { [id]: evidence }
    }, "/virtual/meta.json")).toThrow(message);
  });
});
