import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { assertOutputSchema } from "../src/lib/output-schema.js";
import { createFixture } from "./helpers.js";

describe("llmdoc cli", () => {
  test("all public json payloads validate through runtime output schemas", async () => {
    const rootDir = createFixture();
    const fingerprint = await runCli(["--json", "fingerprint", "--update", "api-client/overview.mdx"], rootDir);
    expect(() => JSON.parse(fingerprint.stdout)).not.toThrow();
    const prune = await runCli(["--json", "prune", "--report"], rootDir);
    expect(() => JSON.parse(prune.stdout)).not.toThrow();
    const upgrade = await runCli(["--json", "upgrade"], rootDir);
    expect(() => JSON.parse(upgrade.stdout)).not.toThrow();
    const created = await runCli(["--json", "new", "fresh-topic/getting-started.mdx", "--kind", "guide"], rootDir);
    expect(() => JSON.parse(created.stdout)).not.toThrow();
    const moved = await runCli(["--json", "mv", "api-client/retry-policy.mdx", "api-client/retry-strategy.mdx"], rootDir);
    expect(() => JSON.parse(moved.stdout)).not.toThrow();
    const stop = await runCli(["hook", "stop"], rootDir);
    expect(() => JSON.parse(stop.stdout)).not.toThrow();
    const compact = await runCli(["hook", "compact"], rootDir);
    expect(() => JSON.parse(compact.stdout)).not.toThrow();
  });

  test("output schema validator accepts the v3-ng status contract and rejects stale or malformed payloads", () => {
    expect(() =>
      assertOutputSchema("status", {
        schema: "llmdoc.status/v1",
        repositoryId: "llmdoc-00000000000000000000000000000000",
        knowledgeRoot: "C:/knowledge",
        sourceRevision: "a".repeat(40),
        knowledgeRevision: "b".repeat(40),
        knowledgeBranch: "main",
        sourceBlockers: [],
        historyAvailable: true,
        lastGlobalReviewRevision: null,
        index: { clean: true, stagedPaths: [] },
        drafts: [],
        documents: { total: 1, current: 1, needsReview: 0, unverified: 0 },
        reviewObligations: [],
        issues: []
      })
    ).not.toThrow();

    // A legacy V3 status payload must not satisfy the v3-ng contract.
    expect(() =>
      assertOutputSchema("status", {
        baseline: null,
        head: null,
        commitsBehindHead: null,
        degradedReason: null,
        documents: { total: 1, impacted: 0, needsReview: 0, dirty: 0, extra: true },
        unmapped: { committed: [], dirty: [] },
        growth: {
          currentDocumentCount: 1,
          currentTotalEstimatedTokens: 1,
          baselineDocumentCount: 1,
          baselineTotalEstimatedTokens: 1,
          documentDelta: 0,
          tokenDelta: 0,
          exceedsGate: false
        }
      })
    ).toThrow("Internal output contract error");

    expect(() =>
      assertOutputSchema("hook", {
        continue: true,
        systemMessage: 42
      })
    ).toThrow("Internal output contract error");
  });
});
