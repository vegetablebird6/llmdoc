import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { resolveWriteBinding } from "../src/lib/knowledge/binding.js";
import { initKnowledgeRepository } from "../src/lib/knowledge/init.js";
import { loadKnowledgeLayoutConfig } from "../src/lib/knowledge/knowledge-config.js";
import { emptyRegistryDocument, insertBinding, readRegistryDocument, writeRegistryDocument } from "../src/lib/knowledge/registry.js";
import { generateRepositoryId } from "../src/lib/knowledge/identity.js";
import {
  commitFile,
  expectKnowledgeError,
  head,
  initRepo,
  makeTempDir,
  realPath,
  snapshotWorktree,
  sourceIndexBytes
} from "./knowledge-helpers.js";

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

function symlinkDir(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
  createdDirs.push(linkPath);
}

describe("R4: realpath pre-check before any disk writes", () => {
  it("rejects a nested target behind a junction that leaves the source, without creating anything", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-r4a-");
    const outside = makeTempDir("llmdoc-knowledge-r4a-out-");
    createdDirs.push(outside);
    symlinkDir(outside, path.join(source, "junction-out"));
    const sourceReal = realPath(source);
    const filesBefore = snapshotWorktree(sourceReal);

    await expectKnowledgeError(
      () =>
        initKnowledgeRepository({
          sourceInput: source,
          knowledgeInput: path.join(source, "junction-out", "knowledge"),
          nested: true,
          registryDir
        }),
      "E_NESTED_NOT_INSIDE_SOURCE"
    );

    expect(fs.existsSync(path.join(outside, "knowledge"))).toBe(false);
    expect(fs.existsSync(path.join(source, "junction-out", "knowledge"))).toBe(false);
    expect(snapshotWorktree(sourceReal)).toEqual(filesBefore);
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
    void base;
  });

  it("rejects an external target behind a junction that enters the source, without creating anything", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-r4b-");
    fs.mkdirSync(path.join(source, "inner"));
    const outside = makeTempDir("llmdoc-knowledge-r4b-out-");
    createdDirs.push(outside);
    symlinkDir(path.join(source, "inner"), path.join(outside, "junction-in"));
    const outsideBefore = fs.readdirSync(outside);

    await expectKnowledgeError(
      () =>
        initKnowledgeRepository({
          sourceInput: source,
          knowledgeInput: path.join(outside, "junction-in", "knowledge"),
          registryDir
        }),
      "E_NESTED_MODE_REQUIRED"
    );

    expect(fs.existsSync(path.join(source, "inner", "knowledge"))).toBe(false);
    expect(fs.readdirSync(outside)).toEqual(outsideBefore);
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
    void base;
  });
});

describe("R5: init atomicity under registry conflicts, lock waits and faults", () => {
  it("refuses a registry-occupied empty knowledge root before creating anything", async () => {
    const { base, registryDir } = makeSource("llmdoc-knowledge-r5a-");
    const other = initRepo(`${base}/other`);
    commitFile(other, "lib/x.ts", "export {}\n", "init");
    const empty = `${base}/empty`;
    fs.mkdirSync(empty);
    const document = emptyRegistryDocument();
    insertBinding(document, { repositoryId: generateRepositoryId(), sourcePath: other, knowledgeRoot: empty });
    writeRegistryDocument(registryDir, document);

    await expectKnowledgeError(
      () => initKnowledgeRepository({ sourceInput: other, knowledgeInput: empty, registryDir }),
      "E_BINDING_CONFLICT"
    );

    expect(fs.readdirSync(empty)).toEqual([]);
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(1);
  });

  it("re-checks an empty target after waiting for the registry lock", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-r5b-");
    fs.mkdirSync(registryDir, { recursive: true });
    const target = `${base}/late`;
    fs.mkdirSync(target);
    const lockPath = path.join(registryDir, "bindings.lock");
    fs.writeFileSync(lockPath, JSON.stringify({ ownerToken: "foreign", pid: 999, host: "x" }));
    setTimeout(() => {
      fs.writeFileSync(path.join(target, "late.txt"), "changed while locked\n");
      fs.rmSync(lockPath, { force: true });
    }, 150);

    await expectKnowledgeError(
      () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: target, registryDir }),
      "E_INIT_TARGET_NOT_EMPTY"
    );

    expect(fs.readdirSync(target)).toEqual(["late.txt"]);
    expect(fs.existsSync(path.join(target, ".git"))).toBe(false);
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
    void base;
  });

  it("removes a self-created target and leaves no registry entry when the skeleton write fails", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-r5c-");
    const target = `${base}/knowledge`;
    const realWrite = fs.writeFileSync.bind(fs);
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((file: unknown, ...rest: unknown[]) => {
      if (String(file).endsWith("llmdoc.yaml")) {
        throw new Error("injected skeleton failure");
      }
      return (realWrite as unknown as (...args: unknown[]) => ReturnType<typeof realWrite>)(file, ...rest);
    }) as unknown as typeof fs.writeFileSync);
    const headBefore = head(source);
    const indexBefore = sourceIndexBytes(realPath(source));
    try {
      await expectKnowledgeError(
        () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: target, registryDir }),
        "E_FILESYSTEM_IO",
        70
      );
    } finally {
      spy.mockRestore();
    }

    expect(fs.existsSync(target)).toBe(false);
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
    expect(head(source)).toBe(headBefore);
    expect(sourceIndexBytes(realPath(source)).equals(indexBefore)).toBe(true);
    void base;
  });

  it("keeps a pre-existing empty target and removes only llmdoc artifacts when the skeleton write fails", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-r5d-");
    const target = `${base}/knowledge`;
    fs.mkdirSync(target);
    const realWrite = fs.writeFileSync.bind(fs);
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((file: unknown, ...rest: unknown[]) => {
      if (String(file).endsWith("llmdoc.yaml")) {
        throw new Error("injected skeleton failure");
      }
      return (realWrite as unknown as (...args: unknown[]) => ReturnType<typeof realWrite>)(file, ...rest);
    }) as unknown as typeof fs.writeFileSync);
    try {
      await expectKnowledgeError(
        () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: target, registryDir }),
        "E_FILESYSTEM_IO",
        70
      );
    } finally {
      spy.mockRestore();
    }

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readdirSync(target)).toEqual([]);
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
    void base;
  });
});

describe("R6: registry/config I/O failures surface as stable KnowledgeError (exit 70)", () => {
  it("reports E_FILESYSTEM_IO when the registry directory is a file", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-r6a-");
    fs.writeFileSync(registryDir, "not a directory");

    await expectKnowledgeError(
      () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir }),
      "E_FILESYSTEM_IO",
      70
    );
    expect(fs.existsSync(`${base}/knowledge`)).toBe(false);
  });

  it("reports E_FILESYSTEM_IO when llmdoc.yaml cannot be read as a file", async () => {
    const { base } = makeSource("llmdoc-knowledge-r6b-");
    const knowledge = initRepo(`${base}/knowledge`);
    fs.mkdirSync(path.join(knowledge, "llmdoc.yaml"));

    await expectKnowledgeError(() => loadKnowledgeLayoutConfig(knowledge), "E_FILESYSTEM_IO", 70);
    void base;
  });
});

describe("R7: a verified precise binding carries the repositoryId on the SourceContext", () => {
  it("fills SourceContext.repositoryId after identity verification", async () => {
    const base = makeTempDir("llmdoc-knowledge-r7-");
    createdDirs.push(base);
    const registryDir = `${base}/registry`;
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    const result = await initKnowledgeRepository({
      sourceInput: source,
      knowledgeInput: `${base}/knowledge`,
      registryDir
    });

    const binding = await resolveWriteBinding({ sourceInput: source, registryDir });

    expect(binding.source.repositoryId).toBe(result.repositoryId);
    expect(binding.entry.repositoryId).toBe(result.repositoryId);
  });
});

describe("R9: target existence is decided at the final in-lock pre-check", () => {
  it("keeps an externally created empty target that appears during the registry lock wait", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-knowledge-r9-");
    fs.mkdirSync(registryDir, { recursive: true });
    const target = `${base}/late-empty`;
    const lockPath = path.join(registryDir, "bindings.lock");
    fs.writeFileSync(lockPath, JSON.stringify({ ownerToken: "foreign", pid: 888, host: "x" }));
    setTimeout(() => {
      fs.mkdirSync(target, { recursive: true });
      fs.rmSync(lockPath, { force: true });
    }, 150);

    const realWrite = fs.writeFileSync.bind(fs);
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((file: unknown, ...rest: unknown[]) => {
      if (String(file).endsWith("llmdoc.yaml")) {
        throw new Error("injected skeleton failure");
      }
      return (realWrite as unknown as (...args: unknown[]) => ReturnType<typeof realWrite>)(file, ...rest);
    }) as unknown as typeof fs.writeFileSync);
    try {
      await expectKnowledgeError(
        () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: target, registryDir }),
        "E_FILESYSTEM_IO",
        70
      );
    } finally {
      spy.mockRestore();
    }

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readdirSync(target)).toEqual([]);
    expect(fs.existsSync(path.join(target, ".git"))).toBe(false);
    expect(readRegistryDocument(registryDir).bindings).toHaveLength(0);
    void base;
  });
});
