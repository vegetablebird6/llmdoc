import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60000 });

import { runCli } from "../src/cli.js";
import { parseViewerPort, runServe, startKnowledgeViewerServer, type KnowledgeViewerServer } from "../src/commands/serve.js";
import { assertOutputSchema } from "../src/lib/output-schema.js";
import { captureCandidate } from "../src/lib/knowledge/capture.js";
import {
  createKnowledgeFixture,
  knowledgeDoc,
  makeTempDir,
  snapshotWorktree,
  sourceIndexBytes,
  writeFile,
  head
} from "./knowledge-helpers.js";

const createdDirs: string[] = [];
const servers: KnowledgeViewerServer[] = [];

function track(dir: string): string {
  createdDirs.push(dir);
  return dir;
}

class CaptureSink {
  private chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  get text(): string {
    return this.chunks.join("");
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the serve start notification");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

afterAll(async () => {
  for (const server of servers) {
    await server.close();
  }
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("knowledge viewer (read-only)", () => {
  it("serves the fixed Knowledge HEAD docs with tri-state, blockers and double revision", async () => {
    const fixture = await createKnowledgeFixture(
      "llmdoc-viewer-",
      { "src/api/retry.ts": "export const retry = 1;\n" },
      [
        { id: "architecture.md", content: knowledgeDoc("architecture", "Retry architecture", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
      ]
    );
    track(fixture.base);
    const sourceBefore = snapshotWorktree(fixture.source);
    const indexBefore = sourceIndexBytes(fixture.source);

    const server = await startKnowledgeViewerServer({ cwd: fixture.source, registryDir: fixture.registryDir });
    servers.push(server);

    const stateResponse = await fetch(`${server.url}/api/state`);
    expect(stateResponse.status).toBe(200);
    const state = (await stateResponse.json()) as Record<string, unknown>;
    expect(state.mode).toBe("bound");
    expect(state.repositoryId).toBe(fixture.repositoryId);
    expect(state.knowledgeRevision).toBe(fixture.knowledgeHead);
    expect(state.sourceRevision).toBe(fixture.sourceHead);
    expect(state.historyAvailable).toBe(true);
    const nodes = state.nodes as Array<Record<string, unknown>>;
    expect(nodes.map((node) => node.id)).toContain("architecture.md");
    expect(nodes[0]!.status).toBe("current");
    expect(nodes[0]!.sourcePaths).toEqual(["src/api/retry.ts"]);

    const docResponse = await fetch(`${server.url}/api/doc?path=${encodeURIComponent("architecture.md")}`);
    const document = (await docResponse.json()) as Record<string, unknown>;
    expect(document.id).toBe("architecture.md");
    expect(document.kind).toBe("architecture");
    expect(document.status).toBe("current");
    expect(document.body).toContain("# Retry architecture");

    const html = await fetch(`${server.url}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    const asset = await fetch(`${server.url}/assets/viewer-app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");

    expect(snapshotWorktree(fixture.source)).toEqual(sourceBefore);
    expect(sourceIndexBytes(fixture.source)).toEqual(indexBefore);
    expect(head(fixture.source)).toBe(fixture.sourceHead);
  });

  it("never lists inbox candidates as formal knowledge", async () => {
    const fixture = await createKnowledgeFixture(
      "llmdoc-viewer-inbox-",
      { "src/api/retry.ts": "export const retry = 1;\n" },
      [
        { id: "architecture.md", content: knowledgeDoc("architecture", "Retry architecture", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
      ]
    );
    track(fixture.base);
    await captureCandidate({
      sourceInput: fixture.source,
      registryDir: fixture.registryDir,
      title: "Candidate idea",
      body: "An unverified idea."
    });

    const server = await startKnowledgeViewerServer({ cwd: fixture.source, registryDir: fixture.registryDir });
    servers.push(server);
    const state = (await (await fetch(`${server.url}/api/state`)).json()) as { nodes: Array<{ id: string }> };
    expect(state.nodes.map((node) => node.id)).not.toContain("inbox/candidate-idea.md");
    expect(state.nodes.every((node) => !node.id.startsWith("inbox/"))).toBe(true);

    await expectDocumentNotFound(server, "inbox/candidate-idea.md");
    await expectDocumentNotFound(server, "candidate-idea.md");
    await expectDocumentNotFound(server, "../llmdoc.yaml");
  });

  it("serves formal docs only from the fixed Knowledge HEAD, never dirty worktree docs", async () => {
    const fixture = await createKnowledgeFixture(
      "llmdoc-viewer-head-",
      { "src/api/retry.ts": "export const retry = 1;\n" },
      [
        { id: "architecture.md", content: knowledgeDoc("architecture", "Retry architecture", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
      ]
    );
    track(fixture.base);
    writeFile(fixture.knowledgeRoot, "docs/secret.md", knowledgeDoc("guide", "Dirty secret", { paths: ["src/api/retry.ts"] }));

    const server = await startKnowledgeViewerServer({ cwd: fixture.source, registryDir: fixture.registryDir });
    servers.push(server);

    await expectDocumentNotFound(server, "secret.md");
    const formal = await fetch(`${server.url}/api/doc?path=architecture.md`);
    expect(formal.status).toBe(200);
  });

  it("returns a diagnostic state without a binding and does not initialize anything", async () => {
    const dir = track(makeTempDir("llmdoc-viewer-unbound-"));
    const registryParent = track(makeTempDir("llmdoc-viewer-unbound-registry-"));
    const server = await startKnowledgeViewerServer({ cwd: dir, registryDir: registryParent });
    servers.push(server);

    const state = (await (await fetch(`${server.url}/api/state`)).json()) as Record<string, unknown>;
    expect(state.mode).toBe("diagnostic");
    expect((state.diagnostic as { code: string }).code).toBeDefined();
    expect(state.nodes).toEqual([]);

    const doc = await fetch(`${server.url}/api/doc?path=architecture.md`);
    expect(doc.status).toBe(404);
  });

  it("emits a schema-valid serve start notification and keeps serving until interrupted", async () => {
    const dir = track(makeTempDir("llmdoc-serve-json-"));
    const registryParent = track(makeTempDir("llmdoc-serve-json-registry-"));
    const sink = new CaptureSink();
    const controller = new AbortController();
    const running = runServe(
      { cwd: dir, registryDir: registryParent, port: 0, json: true },
      { stdout: sink, signal: controller.signal }
    );
    try {
      await waitFor(() => sink.text.includes("\n"));
      const line = sink.text.trim();
      expect(line.split("\n")).toHaveLength(1);
      const payload = JSON.parse(line) as { schema: string; url: string; port: number };
      expect(payload.schema).toBe("llmdoc.serve/v1");
      expect(payload.port).toBeGreaterThan(0);
      assertOutputSchema("serve", payload);

      const state = await fetch(`${payload.url}/api/state`);
      expect(state.status).toBe(200);
    } finally {
      controller.abort();
      await running;
    }
  });

  it("renders a coherent text start line in text mode", async () => {
    const dir = track(makeTempDir("llmdoc-serve-text-"));
    const registryParent = track(makeTempDir("llmdoc-serve-text-registry-"));
    const sink = new CaptureSink();
    const controller = new AbortController();
    const running = runServe(
      { cwd: dir, registryDir: registryParent, port: 0, json: false },
      { stdout: sink, signal: controller.signal }
    );
    try {
      await waitFor(() => sink.text.includes("\n"));
      expect(sink.text).toMatch(/^llmdoc viewer: http:\/\/127\.0\.0\.1:\d+ {2}\(press Ctrl-C to stop\)\n$/);
    } finally {
      controller.abort();
      await running;
    }
  });

  it("reports every malformed or out-of-range port as E_INVALID_PORT with exit code 2", async () => {
    const dir = track(makeTempDir("llmdoc-serve-port-"));
    for (const value of ["nope", "abc", "1.5", "70000", "65536", "-1", ""]) {
      const result = await runCli(["--json", "serve", "--port", value], dir);
      expect(result.exitCode, value).toBe(2);
      const payload = JSON.parse(result.stdout) as { error?: { code?: string } };
      expect(payload.error?.code, value).toBe("E_INVALID_PORT");
      assertOutputSchema("knowledgeError", payload);
    }

    const equalsForm = await runCli(["--json", "serve", "--port=-1"], dir);
    expect(equalsForm.exitCode).toBe(2);
    expect((JSON.parse(equalsForm.stdout) as { error?: { code?: string } }).error?.code).toBe("E_INVALID_PORT");
  });

  it("keeps port 0 valid and applies the same contract through the built CLI binary", () => {
    expect(parseViewerPort("0")).toBe(0);
    expect(() => parseViewerPort("65536")).toThrowError(/Invalid viewer port/);

    const builtBin = path.resolve(__dirname, "..", "dist", "bin", "llmdoc.js");
    expect(fs.existsSync(builtBin)).toBe(true);
    const dir = track(makeTempDir("llmdoc-serve-built-"));
    for (const value of ["nope", "70000"]) {
      const result = spawnSync(process.execPath, [builtBin, "--json", "serve", "--port", value], {
        cwd: dir,
        encoding: "utf8"
      });
      expect(result.status, value).toBe(2);
      const payload = JSON.parse(result.stdout) as { error?: { code?: string } };
      expect(payload.error?.code, value).toBe("E_INVALID_PORT");
    }
  });
});

async function expectDocumentNotFound(server: KnowledgeViewerServer, documentId: string): Promise<void> {
  const first = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(documentId)}`);
  expect(first.status).toBe(404);
  const firstBytes = Buffer.from(await first.arrayBuffer());
  const second = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(documentId)}`);
  expect(second.status).toBe(404);
  const secondBytes = Buffer.from(await second.arrayBuffer());
  expect(secondBytes.equals(firstBytes)).toBe(true);
  expect(JSON.parse(firstBytes.toString("utf8"))).toMatchObject({
    schema: "llmdoc.viewer-doc/v1",
    error: "document_not_found",
    documentId
  });
}
