import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { runValidate, type ValidateResult } from "../src/commands/validate.js";
import { createKnowledgeFixture, knowledgeDoc, type FixtureDoc, type KnowledgeFixture } from "./knowledge-helpers.js";

const createdDirs: string[] = [];

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort
    }
  }
});

async function makeFixture(prefix: string, docs: FixtureDoc[]): Promise<KnowledgeFixture> {
  const fixture = await createKnowledgeFixture(prefix, { "src/a.ts": "export const a = 1;\n" }, docs);
  createdDirs.push(fixture.base);
  return fixture;
}

function options(fixture: KnowledgeFixture) {
  return { cwd: fixture.source, source: fixture.source, knowledge: fixture.knowledgeRoot, registryDir: fixture.registryDir, json: true };
}

interface ValidatePayload {
  schema: string;
  ok: boolean;
  errors: Array<{ code: string; path: string; message: string }>;
  warnings: Array<{ code: string; path: string; message: string }>;
}

function payload(result: ValidateResult): ValidatePayload {
  return result.output as ValidatePayload;
}

describe("knowledge validate", () => {
  it("passes for a structurally valid bound knowledge repository", async () => {
    const fixture = await makeFixture("llmdoc-validate-ok-", [
      { id: "a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n" }), scope: ["src/a.ts"] }
    ]);
    const result = await runValidate(options(fixture));
    expect(result.exitCode).toBe(0);
    expect(payload(result)).toMatchObject({ schema: "llmdoc.validate/v1", ok: true, errors: [], warnings: [] });
  });

  it("reports front matter, kind, scope escape, link, cycle and supersedes errors with exit 2", async () => {
    const fixture = await makeFixture("llmdoc-validate-errors-", [
      { id: "bad-kind.md", content: knowledgeDoc("bogus", "Bad", { paths: ["src/a.ts"] }), scope: ["src/a.ts"] },
      { id: "escape.md", content: knowledgeDoc("guide", "Escape", { paths: ["../secret"] }), scope: ["../secret"] },
      { id: "linker.md", content: knowledgeDoc("guide", "Linker", { paths: ["src/a.ts"], body: "See [missing](missing.md).\n" }), scope: ["src/a.ts"] },
      { id: "cyc-a.md", content: knowledgeDoc("guide", "Cycle A", { paths: ["src/a.ts"], requires: ["cyc-b.md"] }), scope: ["src/a.ts"], requires: ["cyc-b.md"] },
      { id: "cyc-b.md", content: knowledgeDoc("guide", "Cycle B", { paths: ["src/a.ts"], requires: ["cyc-a.md"] }), scope: ["src/a.ts"], requires: ["cyc-a.md"] },
      { id: "super.md", content: knowledgeDoc("guide", "Super", { paths: ["src/a.ts"], supersedes: ["linker.md"] }), scope: ["src/a.ts"] }
    ]);
    const result = await runValidate(options(fixture));
    expect(result.exitCode).toBe(2);
    const codes = payload(result).errors.map((issue) => issue.code);
    expect(codes).toContain("document.invalid");
    expect(codes).toContain("source.paths.invalid");
    expect(codes).toContain("link.missing");
    expect(codes).toContain("relations.requires.cycle");
    expect(codes).toContain("relations.supersedes.target-kind");
  });

  it("reports source evidence that is absent or empty at the fixed source snapshot", async () => {
    const fixture = await makeFixture("llmdoc-validate-evidence-", [
      { id: "literal.md", content: knowledgeDoc("guide", "Literal", { paths: ["src/nope.ts"] }), scope: ["src/nope.ts"] },
      { id: "glob.md", content: knowledgeDoc("guide", "Glob", { paths: ["src/*.tsx"] }), scope: ["src/*.tsx"] }
    ]);
    const result = await runValidate(options(fixture));
    expect(result.exitCode).toBe(2);
    const codes = payload(result).errors.map((issue) => issue.code);
    expect(codes).toContain("source.paths.missing");
    expect(codes).toContain("source.paths.glob-empty");
  });

  it("never advances the validation revision", async () => {
    const fixture = await makeFixture("llmdoc-validate-frozen-", [
      { id: "a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n" }), scope: ["src/a.ts"] }
    ]);
    const metaPath = path.join(fixture.knowledgeRoot, ".llmdoc", "meta.json");
    const before = fs.readFileSync(metaPath, "utf8");
    await runValidate(options(fixture));
    expect(fs.readFileSync(metaPath, "utf8")).toBe(before);
  });
});
