import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import { generateRepositoryId } from "../src/lib/knowledge/identity.js";
import {
  emptyRegistryDocument,
  findBindingsByKnowledgeRoot,
  findBindingsBySourcePath,
  insertBinding,
  readRegistryDocument,
  registryFilePath,
  resolveRegistryDir,
  withRegistryLock,
  writeRegistryDocument
} from "../src/lib/knowledge/registry.js";
import { makeTempDir } from "./knowledge-helpers.js";

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

describe("registry location", () => {
  it("honors an explicit directory", () => {
    expect(resolveRegistryDir("tmp/reg")).toBe(path.resolve("tmp/reg"));
  });

  itOnWindows("derives the default directory from APPDATA", () => {
    const fakeAppData = makeTempDir("llmdoc-knowledge-appdata-");
    createdDirs.push(fakeAppData);
    const previous = process.env.APPDATA;
    process.env.APPDATA = fakeAppData;
    try {
      expect(resolveRegistryDir()).toBe(path.join(fakeAppData, "llmdoc"));
    } finally {
      restoreEnv("APPDATA", previous);
    }
  });

  itOnWindows("fails with E_REGISTRY_UNAVAILABLE when APPDATA is missing", () => {
    const previous = process.env.APPDATA;
    delete process.env.APPDATA;
    try {
      expectKnowledgeErrorCode(() => resolveRegistryDir(), "E_REGISTRY_UNAVAILABLE", 70);
    } finally {
      restoreEnv("APPDATA", previous);
    }
  });
});

describe("registry document", () => {
  it("round-trips documents atomically", () => {
    const dir = makeTempDir("llmdoc-knowledge-reg-");
    createdDirs.push(dir);

    expect(readRegistryDocument(dir)).toEqual(emptyRegistryDocument());

    const document = emptyRegistryDocument();
    insertBinding(document, {
      repositoryId: generateRepositoryId(),
      sourcePath: "C:/src/a",
      knowledgeRoot: "C:/know/a"
    });
    writeRegistryDocument(dir, document);
    writeRegistryDocument(dir, document);

    const loaded = readRegistryDocument(dir);
    expect(loaded.bindings).toHaveLength(1);
    expect(loaded.bindings[0]!.sourcePath).toBe("C:/src/a");
    expect(fs.existsSync(`${registryFilePath(dir)}.tmp-`)).toBe(false);
  });

  it("rejects invalid documents instead of guessing", () => {
    const dir = makeTempDir("llmdoc-knowledge-regbad-");
    createdDirs.push(dir);
    fs.mkdirSync(dir, { recursive: true });

    const cases: unknown[] = [
      "{ not json",
      JSON.stringify({ schema: "other/v1", bindings: [] }),
      JSON.stringify({ schema: "llmdoc.bindings/v1", bindings: "no" }),
      JSON.stringify({ schema: "llmdoc.bindings/v1", bindings: [{ repositoryId: "nope", sourcePath: "a", knowledgeRoot: "b" }] }),
      JSON.stringify({ schema: "llmdoc.bindings/v1", bindings: [{ repositoryId: generateRepositoryId(), sourcePath: "" }] })
    ];
    for (const [index, content] of cases.entries()) {
      fs.writeFileSync(path.join(dir, "bindings.json"), String(content));
      try {
        readRegistryDocument(dir);
        expect.unreachable(`case ${index} should have failed`);
      } catch (error) {
        expect(error).toBeInstanceOf(KnowledgeError);
        expect((error as KnowledgeError).code).toBe("E_REGISTRY_INVALID");
      }
    }
  });

  itOnWindows("matches bound paths case-insensitively on Windows", () => {
    const document = emptyRegistryDocument();
    insertBinding(document, {
      repositoryId: generateRepositoryId(),
      sourcePath: "C:\\Src\\Alpha",
      knowledgeRoot: "C:\\Know\\Alpha"
    });
    const hits = findBindingsBySourcePath(document, "c:\\src\\ALPHA");
    expect(hits).toHaveLength(1);
    expect(findBindingsByKnowledgeRoot(document, "c:/know/alpha")).toHaveLength(1);
  });
});

describe("registry lock", () => {
  it("releases the lock after the operation and blocks concurrent writers", async () => {
    const dir = makeTempDir("llmdoc-knowledge-lock-");
    createdDirs.push(dir);

    const result = await withRegistryLock(dir, () => 41 + 1);
    expect(result).toBe(42);
    expect(fs.existsSync(path.join(dir, "bindings.lock"))).toBe(false);

    fs.writeFileSync(path.join(dir, "bindings.lock"), JSON.stringify({ ownerToken: "foreign", pid: 1234, host: "other" }));
    try {
      await withRegistryLock(dir, () => {
        throw new Error("must not run");
      });
      expect.unreachable("lock should have blocked");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeError);
      const knowledgeError = error as KnowledgeError;
      expect(knowledgeError.code).toBe("E_REGISTRY_LOCKED");
      expect(knowledgeError.exitCode).toBe(70);
      expect(knowledgeError.remediation).toContain("pid 1234");
    }

    fs.rmSync(path.join(dir, "bindings.lock"), { force: true });
    expect(await withRegistryLock(dir, () => "again")).toBe("again");
  });

  it("does not delete a foreign lock that changed during the operation", async () => {
    const dir = makeTempDir("llmdoc-knowledge-lock2-");
    createdDirs.push(dir);

    await withRegistryLock(dir, () => {
      fs.writeFileSync(path.join(dir, "bindings.lock"), JSON.stringify({ ownerToken: "someone-else", pid: 1, host: "x" }));
    });

    expect(fs.existsSync(path.join(dir, "bindings.lock"))).toBe(true);
  });
});

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

function expectKnowledgeErrorCode(run: () => unknown, code: string, exitCode: number): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    expect((error as KnowledgeError).code).toBe(code);
    expect((error as KnowledgeError).exitCode).toBe(exitCode);
    return;
  }
  throw new Error(`expected ${code}`);
}

const itOnWindows = process.platform === "win32" ? it : it.skip;
