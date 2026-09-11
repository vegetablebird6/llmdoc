import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { load, dump } from "js-yaml";

import { bindKnowledge } from "../src/lib/knowledge/bind.js";
import { initKnowledgeRepository } from "../src/lib/knowledge/init.js";
import { readRegistryDocument } from "../src/lib/knowledge/registry.js";
import { generateRepositoryId } from "../src/lib/knowledge/identity.js";
import { loadKnowledgeLayoutConfig } from "../src/lib/knowledge/knowledge-config.js";
import { resolveSourceContext } from "../src/lib/knowledge/contexts.js";
import { commitFile, expectKnowledgeError, git, head, initRepo, makeTempDir } from "./knowledge-helpers.js";

const createdDirs: string[] = [];

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort cleanup of temp fixtures
    }
  }
});

function makeSource(prefix: string): { base: string; registryDir: string; source: string } {
  const base = makeTempDir(prefix);
  createdDirs.push(base);
  const source = initRepo(`${base}/source`);
  commitFile(source, "src/main.ts", "export {}\n", "init");
  return { base, registryDir: `${base}/registry`, source };
}

describe("initKnowledgeRepository", () => {
  it("creates an independent external knowledge repository, identity, initial commit and binding", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-init-");

    const result = await initKnowledgeRepository({
      sourceInput: source,
      knowledgeInput: `${base}/knowledge`,
      registryDir
    });

    expect(result.repositoryId).toMatch(/^llmdoc-[0-9a-f]{32}$/);
    expect(result.knowledgeRoot).toBe(path.resolve(`${base}/knowledge`));
    expect(result.knowledgeCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(head(result.knowledgeRoot)).toBe(result.knowledgeCommit);

    expect(fs.existsSync(path.join(result.knowledgeRoot, "llmdoc.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(result.knowledgeRoot, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(result.knowledgeRoot, "docs"))).toBe(true);
    expect(fs.existsSync(path.join(result.knowledgeRoot, "inbox"))).toBe(true);
    expect(fs.readFileSync(path.join(result.knowledgeRoot, ".gitignore"), "utf8")).toContain(".llmdoc-cache/");

    const config = loadKnowledgeLayoutConfig(result.knowledgeRoot)!;
    expect(config.repositoryId).toBe(result.repositoryId);
    expect(config.layoutVersion).toBe(1);

    const meta = JSON.parse(fs.readFileSync(path.join(result.knowledgeRoot, ".llmdoc", "meta.json"), "utf8")) as {
      schema: string;
      source: { repositoryId: string; lastGlobalReviewRevision: string | null };
      documents: Record<string, never>;
    };
    expect(meta.schema).toBe("llmdoc.meta/v3-ng");
    expect(meta.source.repositoryId).toBe(result.repositoryId);
    expect(meta.source.lastGlobalReviewRevision).toBeNull();

    const knowledgeState = await resolveSourceContext(result.knowledgeRoot);
    expect(knowledgeState.clean).toBe(true);
    expect(knowledgeState.headRevision).toBe(result.knowledgeCommit);

    const registry = readRegistryDocument(registryDir);
    expect(registry.bindings).toHaveLength(1);
    expect(registry.bindings[0]!.repositoryId).toBe(result.repositoryId);
    expect(registry.bindings[0]!.sourcePath).toBe(path.resolve(source));
    expect(registry.bindings[0]!.knowledgeRoot).toBe(result.knowledgeRoot);

    const sourceState = await resolveSourceContext(source);
    expect(sourceState.clean).toBe(true);
    expect(sourceState.worktreeRoot).toBe(path.resolve(source));
  });

  it("refuses non-empty targets", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-initne-");
    fs.mkdirSync(`${base}/knowledge`);
    fs.writeFileSync(`${base}/knowledge/sentinel.txt`, "keep\n");

    await expectKnowledgeError(
      () =>
        initKnowledgeRepository({
          sourceInput: source,
          knowledgeInput: `${base}/knowledge`,
          registryDir
        }),
      "E_INIT_TARGET_NOT_EMPTY"
    );
    expect(fs.readFileSync(`${base}/knowledge/sentinel.txt`, "utf8")).toBe("keep\n");
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
  });

  it("refuses to rebind an already bound source", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-initrb-");
    await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge1`, registryDir });

    await expectKnowledgeError(
      () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge2`, registryDir }),
      "E_BINDING_CONFLICT"
    );
    expect(fs.existsSync(`${base}/knowledge2`)).toBe(false);
  });

  it("requires explicit nested mode before creating anything inside the source", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-initnest-");

    await expectKnowledgeError(
      () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/source/knowledge`, registryDir }),
      "E_NESTED_MODE_REQUIRED"
    );
    expect(fs.existsSync(`${base}/source/knowledge`)).toBe(false);

    const result = await initKnowledgeRepository({
      sourceInput: source,
      knowledgeInput: `${base}/source/knowledge`,
      nested: true,
      registryDir
    });
    expect(result.knowledgeRoot).toBe(path.resolve(`${base}/source/knowledge`));
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(1);

    const sourceHeadBefore = head(source);
    const sourceState = await resolveSourceContext(source);
    expect(head(source)).toBe(sourceHeadBefore);
    expect(sourceState.cleanSnapshot.untrackedPaths).toContain("knowledge/");
  });

  it("rejects nested mode for targets outside the source", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-initnestbad-");

    await expectKnowledgeError(
      () =>
        initKnowledgeRepository({
          sourceInput: source,
          knowledgeInput: `${base}/knowledge`,
          nested: true,
          registryDir
        }),
      "E_NESTED_NOT_INSIDE_SOURCE"
    );
    expect(fs.existsSync(`${base}/knowledge`)).toBe(false);
  });
});

describe("bindKnowledge", () => {
  it("binds an existing llmdoc-initialized knowledge repository and is idempotent", async () => {
    const { base, registryDir } = makeSource("llmdoc-knowledge-bind2-");
    const other = initRepo(`${base}/other`);
    commitFile(other, "pkg/x.ts", "export const x = 1;\n", "init");
    const knowledge = initRepo(`${base}/knowledge`);
    const repositoryId = generateRepositoryId();
    fs.writeFileSync(
      path.join(knowledge, "llmdoc.yaml"),
      dump({ schema: "llmdoc.knowledge/v1", repositoryId, layoutVersion: 1, remotes: [] })
    );

    const first = await bindKnowledge({ sourceInput: other, knowledgeInput: knowledge, registryDir });
    expect(first.status).toBe("bound");
    expect(first.repositoryId).toBe(repositoryId);

    const second = await bindKnowledge({ sourceInput: other, knowledgeInput: knowledge, registryDir });
    expect(second.status).toBe("already-bound");
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(1);
  });

  it("refuses to bind a knowledge repository without llmdoc.yaml identity", async () => {
    const { base, registryDir } = makeSource("llmdoc-knowledge-bindraw-");
    const other = initRepo(`${base}/other`);
    commitFile(other, "pkg/x.ts", "export const x = 1;\n", "init");
    const knowledge = initRepo(`${base}/knowledge`);

    await expectKnowledgeError(() => bindKnowledge({ sourceInput: other, knowledgeInput: knowledge, registryDir }), "E_KNOWLEDGE_NOT_INITIALIZED");
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
  });

  it("refuses conflicting rebinds and knowledge-root reuse across sources", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-bindc-");
    const result = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });

    const other = initRepo(`${base}/other`);
    commitFile(other, "pkg/x.ts", "export const x = 1;\n", "init");
    await expectKnowledgeError(() => bindKnowledge({ sourceInput: other, knowledgeInput: result.knowledgeRoot, registryDir }), "E_BINDING_CONFLICT");

    const secondKnowledge = initRepo(`${base}/knowledge2`);
    fs.writeFileSync(
      path.join(secondKnowledge, "llmdoc.yaml"),
      dump({ schema: "llmdoc.knowledge/v1", repositoryId: generateRepositoryId(), layoutVersion: 1, remotes: [] })
    );
    await expectKnowledgeError(() => bindKnowledge({ sourceInput: source, knowledgeInput: secondKnowledge, registryDir }), "E_BINDING_CONFLICT");
  });

  it("records credential-free remote aliases from the source at init", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-initrem-");
    git(source, ["remote", "add", "origin", "https://user:secret@example.com/org/project.git"]);

    const result = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });

    const configRaw = load(fs.readFileSync(path.join(result.knowledgeRoot, "llmdoc.yaml"), "utf8")) as {
      remotes: Array<{ name: string; url: string }>;
    };
    expect(configRaw.remotes).toEqual([{ name: "origin", url: "https://example.com/org/project.git" }]);
  });
});
