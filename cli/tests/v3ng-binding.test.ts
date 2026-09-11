import fs from "node:fs";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { resolveWriteBinding } from "../src/lib/v3ng/binding.js";
import { generateRepositoryId } from "../src/lib/v3ng/identity.js";
import { emptyRegistryDocument, insertBinding, writeRegistryDocument } from "../src/lib/v3ng/registry.js";
import { initKnowledgeRepository } from "../src/lib/v3ng/init.js";
import {
  commitFile,
  expectNgError,
  git,
  head,
  initRepo,
  makeTempDir,
  realPath,
  snapshotWorktree,
  sourceIndexBytes
} from "./v3ng-helpers.js";

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

async function setupBoundPair(prefix: string): Promise<{ source: string; knowledge: string; registryDir: string }> {
  const base = makeTempDir(prefix);
  createdDirs.push(base);
  const registryDir = `${base}/registry`;
  const source = initRepo(`${base}/source`);
  commitFile(source, "src/main.ts", "export {}\n", "init");
  const result = await initKnowledgeRepository({
    sourceInput: source,
    knowledgeInput: `${base}/knowledge`,
    registryDir
  });
  return { source: realPath(source), knowledge: result.knowledgeRoot, registryDir };
}

describe("resolveWriteBinding", () => {
  it("resolves the precise binding recorded in the user registry", async () => {
    const { source, knowledge, registryDir } = await setupBoundPair("llmdoc-v3ng-bindok-");

    const binding = await resolveWriteBinding({ sourceInput: source, registryDir });

    expect(binding.source.worktreeRoot).toBe(source);
    expect(binding.knowledge.worktreeRoot).toBe(knowledge);
    expect(binding.entry.knowledgeRoot).toBe(knowledge);
    expect(binding.entry.repositoryId).toMatch(/^llmdoc-[0-9a-f]{32}$/);
  });

  it("rejects an unbound source instead of granting identity from the path", async () => {
    const base = makeTempDir("llmdoc-v3ng-bindnf-");
    createdDirs.push(base);
    const registryDir = `${base}/registry`;
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");

    await expectNgError(() => resolveWriteBinding({ sourceInput: source, registryDir }), "E_BINDING_NOT_FOUND");
  });

  it("reports ambiguity when the registry has multiple entries for one source path", async () => {
    const { source, registryDir, knowledge } = await setupBoundPair("llmdoc-v3ng-bindamb-");
    const document = emptyRegistryDocument();
    insertBinding(document, { repositoryId: generateRepositoryId(), sourcePath: source, knowledgeRoot: `${knowledge}x` });
    insertBinding(document, { repositoryId: generateRepositoryId(), sourcePath: source, knowledgeRoot: `${knowledge}y` });
    writeRegistryDocument(registryDir, document);

    await expectNgError(() => resolveWriteBinding({ sourceInput: source, registryDir }), "E_BINDING_AMBIGUOUS");
  });

  it("rejects an explicit knowledge root that conflicts with the binding", async () => {
    const { source, knowledge, registryDir } = await setupBoundPair("llmdoc-v3ng-bindconf-");
    const second = initRepo(`${knowledge}2`);
    fs.writeFileSync(`${knowledge}2/llmdoc.yaml`, fs.readFileSync(`${knowledge}/llmdoc.yaml`));

    await expectNgError(
      () => resolveWriteBinding({ sourceInput: source, knowledgeInput: second, registryDir }),
      "E_BINDING_CONFLICT"
    );
  });

  it("reports identity mismatch when the knowledge repository declares another repositoryId", async () => {
    const { source, registryDir, knowledge } = await setupBoundPair("llmdoc-v3ng-bindmis-");
    fs.writeFileSync(`${knowledge}/llmdoc.yaml`, fs.readFileSync(`${knowledge}/llmdoc.yaml`).toString().replace(/llmdoc-[0-9a-f]{32}/, generateRepositoryId()));

    await expectNgError(() => resolveWriteBinding({ sourceInput: source, registryDir }), "E_SOURCE_IDENTITY_MISMATCH");
  });

  it("requires an llmdoc-initialized knowledge repository", async () => {
    const base = makeTempDir("llmdoc-v3ng-bindnoinit-");
    createdDirs.push(base);
    const registryDir = `${base}/registry`;
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    const knowledge = initRepo(`${base}/knowledge`);
    const document = emptyRegistryDocument();
    insertBinding(document, { repositoryId: generateRepositoryId(), sourcePath: source, knowledgeRoot: knowledge });
    writeRegistryDocument(registryDir, document);

    await expectNgError(() => resolveWriteBinding({ sourceInput: source, registryDir }), "E_KNOWLEDGE_NOT_INITIALIZED");
  });

  it("never falls back to the source Git when the bound knowledge Git disappears", async () => {
    const { source, knowledge, registryDir } = await setupBoundPair("llmdoc-v3ng-bindfb-");
    fs.rmSync(`${knowledge}/.git`, { recursive: true, force: true });

    await expectNgError(() => resolveWriteBinding({ sourceInput: source, registryDir }), "E_KNOWLEDGE_REPO_NOT_FOUND");
  });

  it("keeps clones independent: every clone needs its own explicit binding", async () => {
    const { source, knowledge, registryDir } = await setupBoundPair("llmdoc-v3ng-bindclone-");
    const clone = `${source}-clone`;
    git(source, ["clone", "--quiet", source, clone]);
    createdDirs.push(clone);

    await expectNgError(() => resolveWriteBinding({ sourceInput: clone, registryDir }), "E_BINDING_NOT_FOUND");

    const cloneResult = await initKnowledgeRepository({
      sourceInput: clone,
      knowledgeInput: `${knowledge}-clone`,
      registryDir
    });
    const cloneBinding = await resolveWriteBinding({ sourceInput: clone, registryDir });
    expect(cloneBinding.knowledge.worktreeRoot).toBe(cloneResult.knowledgeRoot);

    const originalBinding = await resolveWriteBinding({ sourceInput: source, registryDir });
    expect(originalBinding.knowledge.worktreeRoot).toBe(knowledge);
    expect(originalBinding.knowledge.worktreeRoot).not.toBe(cloneBinding.knowledge.worktreeRoot);
  });

  it("leaves the source repository byte-identical across binding resolutions", async () => {
    const { source, registryDir } = await setupBoundPair("llmdoc-v3ng-bindfrozen-");
    const headBefore = head(source);
    const indexBefore = sourceIndexBytes(source);
    const filesBefore = snapshotWorktree(source);

    await resolveWriteBinding({ sourceInput: source, registryDir });
    await resolveWriteBinding({ sourceInput: source, registryDir });

    expect(head(source)).toBe(headBefore);
    expect(sourceIndexBytes(source).equals(indexBefore)).toBe(true);
    expect(snapshotWorktree(source)).toEqual(filesBefore);
  });
});
