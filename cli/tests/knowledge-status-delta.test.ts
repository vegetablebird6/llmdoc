import fs from "node:fs";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { runStatus, type StatusPayload } from "../src/commands/status.js";
import { runDelta, type DeltaPayload } from "../src/commands/delta.js";
import { advanceSource, createKnowledgeFixture, knowledgeDoc, writeFile, type KnowledgeFixture } from "./knowledge-helpers.js";

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

async function makeFixture(prefix: string): Promise<KnowledgeFixture> {
  const fixture = await createKnowledgeFixture(
    prefix,
    { "src/a.ts": "export const a = 1;\n" },
    [{ id: "a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n" }), scope: ["src/a.ts"] }]
  );
  createdDirs.push(fixture.base);
  return fixture;
}

function options(fixture: KnowledgeFixture) {
  return { cwd: fixture.source, source: fixture.source, knowledge: fixture.knowledgeRoot, registryDir: fixture.registryDir };
}

describe("status and delta diagnostics", () => {
  it("reports the fixed revisions, three-state counts and no obligations for current knowledge", async () => {
    const fixture = await makeFixture("llmdoc-status-clean-");
    const status = (await runStatus({ ...options(fixture), json: true })) as StatusPayload;
    expect(status.schema).toBe("llmdoc.status/v1");
    expect(status.repositoryId).toBe(fixture.repositoryId);
    expect(status.sourceRevision).toBe(fixture.sourceHead);
    expect(status.knowledgeRevision).toBe(fixture.knowledgeHead);
    expect(status.documents).toEqual({ total: 1, current: 1, needsReview: 0, unverified: 0 });
    expect(status.reviewObligations).toEqual([]);
    expect(status.drafts).toEqual([]);
    expect(status.index.clean).toBe(true);

    const delta = (await runDelta({ ...options(fixture), json: true })) as DeltaPayload;
    expect(delta.schema).toBe("llmdoc.delta/v1");
    expect(delta.suggestedMode).toBe("light");
    expect(delta.impacted).toEqual([]);
  });

  it("raises review obligations when committed source under a scope changes", async () => {
    const fixture = await makeFixture("llmdoc-status-source-");
    advanceSource(fixture.source, { "src/a.ts": "export const a = 2;\n" }, "advance");

    const status = (await runStatus({ ...options(fixture), json: true })) as StatusPayload;
    expect(status.documents.needsReview).toBe(1);
    expect(status.reviewObligations.map((entry) => entry.id)).toEqual(["a.md"]);

    const delta = (await runDelta({ ...options(fixture), json: true })) as DeltaPayload;
    expect(delta.suggestedMode).toBe("light");
    expect(delta.impacted.map((impact) => impact.id)).toEqual(["a.md"]);
    expect(delta.impacted[0]!.contentChanged).toBe(false);
  });

  it("switches delta to deep when a document body is edited in the worktree", async () => {
    const fixture = await makeFixture("llmdoc-status-draft-");
    writeFile(fixture.knowledgeRoot, "docs/a.md", knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n\nnew\n" }));

    const status = (await runStatus({ ...options(fixture), json: true })) as StatusPayload;
    expect(status.drafts).toContain("a.md");

    const delta = (await runDelta({ ...options(fixture), json: true })) as DeltaPayload;
    expect(delta.suggestedMode).toBe("deep");
    expect(delta.impacted[0]!.contentChanged).toBe(true);
  });

  it("does not modify the source repository while reporting status and delta", async () => {
    const fixture = await makeFixture("llmdoc-status-frozen-");
    const sourceHeadBefore = fixture.sourceHead;
    await runStatus({ ...options(fixture), json: true });
    await runDelta({ ...options(fixture), json: true });
    expect(fixture.sourceHead).toBe(sourceHeadBefore);
  });
});
