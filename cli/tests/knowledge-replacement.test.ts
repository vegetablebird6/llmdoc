import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { runCli } from "../src/cli.js";
import { contentDigest } from "../src/lib/knowledge/document.js";
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

interface Fixture {
  base: string;
  registryDir: string;
  source: string;
  knowledge: string;
  repositoryId: string;
  sourceHead: string;
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

async function boundFixture(): Promise<Fixture> {
  const base = makeTempDir("llmdoc-knowledge-replacement-");
  createdDirs.push(base);
  const registryDir = `${base}/config/llmdoc`;
  const source = initRepo(`${base}/source`);
  commitFile(source, "src/api/retry.ts", "export const retry = true;\n", "init");
  commitFile(
    source,
    "llmdoc/legacy.mdx",
    "---\ndescription: legacy-mdx-token\nkind: guide\n---\n\n# legacy-mdx-token\n",
    "legacy workspace"
  );
  const sourceHead = head(source);
  const init = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });
  const knowledge = init.knowledgeRoot;
  const raw = knowledgeDoc("guide", "Bound knowledge doc");
  writeFile(knowledge, "docs/guides/g.md", raw);
  writeFile(
    knowledge,
    ".llmdoc/meta.json",
    knowledgeMetaJson(init.repositoryId, sourceHead, {
      "guides/g.md": {
        validatedSourceRevision: sourceHead,
        validatedContentDigest: contentDigest(raw),
        validatedSourcePaths: ["src/api/retry.ts"],
        validatedRequires: {}
      }
    })
  );
  git(knowledge, ["add", "-A"]);
  git(knowledge, ["commit", "-m", "docs: seed knowledge"]);
  return { base, registryDir, source: realPath(source), knowledge, repositoryId: init.repositoryId, sourceHead };
}

describe("breaking replacement: standard read commands", () => {
  it("runs the new protocol for bare commands in a bound cwd", async () => {
    const fixture = await boundFixture();
    await withRegistryDir(fixture.registryDir, async () => {
      const index = await runCli(["--json", "index"], fixture.source);
      expect(index.exitCode).toBe(0);
      const indexPayload = JSON.parse(index.stdout) as {
        schema: string;
        mode: string;
        repositoryId: string;
        documents: Array<{ id: string }>;
      };
      expect(indexPayload.schema).toBe("llmdoc.index/v1");
      expect(indexPayload.mode).toBe("bound");
      expect(indexPayload.repositoryId).toBe(fixture.repositoryId);
      expect(indexPayload.documents.map((entry) => entry.id)).toEqual(["guides/g.md"]);

      const tree = JSON.parse((await runCli(["--json", "tree"], fixture.source)).stdout) as {
        schema: string;
        topics: Array<{ topic: string }>;
      };
      expect(tree.schema).toBe("llmdoc.tree/v1");
      expect(tree.topics.map((entry) => entry.topic)).toEqual(["guides"]);

      const search = JSON.parse((await runCli(["--json", "search", "Bound"], fixture.source)).stdout) as {
        schema: string;
        results: Array<{ id: string }>;
      };
      expect(search.schema).toBe("llmdoc.search/v1");
      expect(search.results.map((entry) => entry.id)).toContain("guides/g.md");

      const show = JSON.parse((await runCli(["--json", "show", "guides/g.md"], fixture.source)).stdout) as {
        schema: string;
        documents: Array<{ body: string }>;
      };
      expect(show.schema).toBe("llmdoc.show/v1");
      expect(show.documents[0]!.body).toContain("Bound knowledge doc");

      const context = JSON.parse(
        (await runCli(["--json", "context", "--files", "src/api/retry.ts"], fixture.source)).stdout
      ) as { schema: string; impacted: Array<{ id: string }> };
      expect(context.schema).toBe("llmdoc.context/v1");
      expect(context.impacted.map((entry) => entry.id)).toEqual(["guides/g.md"]);
    });
  });

  it("fails stably without a binding and never falls back to the source Git", async () => {
    const base = makeTempDir("llmdoc-knowledge-unbound-");
    createdDirs.push(base);
    const source = initRepo(`${base}/source`);
    commitFile(source, "src/main.ts", "export {}\n", "init");
    commitFile(source, "llmdoc/legacy.mdx", "---\ndescription: legacy\nkind: guide\n---\n\n# legacy\n", "legacy");

    await withRegistryDir(`${base}/empty/llmdoc`, async () => {
      const result = await runCli(["--json", "tree"], realPath(source));
      expect(result.exitCode).toBe(2);
      const payload = JSON.parse(result.stdout) as { error: { code: string } };
      expect(payload.error.code).toBe("E_BINDING_NOT_FOUND");
    });
  });

  it("never reads legacy llmdoc/*.mdx through the standard commands", async () => {
    const fixture = await boundFixture();
    await withRegistryDir(fixture.registryDir, async () => {
      const index = JSON.parse((await runCli(["--json", "index"], fixture.source)).stdout) as {
        documents: Array<{ id: string }>;
      };
      expect(index.documents.every((entry) => !entry.id.endsWith(".mdx"))).toBe(true);
      expect(index.documents.some((entry) => entry.id.includes("llmdoc/"))).toBe(false);

      const search = JSON.parse(
        (await runCli(["--json", "search", "legacy-mdx-token"], fixture.source)).stdout
      ) as { results: unknown[] };
      expect(search.results).toEqual([]);

      const show = await runCli(["--json", "show", "llmdoc/legacy.mdx"], fixture.source);
      expect(show.exitCode).toBe(2);
      expect((JSON.parse(show.stdout) as { error: { code: string } }).error.code).toBe("E_KNOWLEDGE_DOC_NOT_FOUND");
    });
  });

  it("selects the same protocol through explicit context parameters", async () => {
    const fixture = await boundFixture();

    const explicit = await runCli(["--json", "index", "--knowledge", fixture.knowledge], fixture.base);
    expect(explicit.exitCode).toBe(0);
    const explicitPayload = JSON.parse(explicit.stdout) as { schema: string; mode: string; documents: Array<{ id: string }> };
    expect(explicitPayload.schema).toBe("llmdoc.index/v1");
    expect(explicitPayload.mode).toBe("explicit");
    expect(explicitPayload.documents.map((entry) => entry.id)).toEqual(["guides/g.md"]);

    await withRegistryDir(fixture.registryDir, async () => {
      const bound = JSON.parse(
        (await runCli(["--json", "index", "--source", fixture.source], fixture.base)).stdout
      ) as { schema: string; mode: string };
      expect(bound.schema).toBe("llmdoc.index/v1");
      expect(bound.mode).toBe("bound");
    });

    const legacyPath = await runCli(
      ["--json", "show", "llmdoc/legacy.mdx", "--knowledge", fixture.knowledge],
      fixture.base
    );
    expect(legacyPath.exitCode).toBe(2);
    expect((JSON.parse(legacyPath.stdout) as { error: { code: string } }).error.code).toBe("E_KNOWLEDGE_DOC_NOT_FOUND");
  });
});
