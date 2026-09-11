import { describe, expect, test } from "vitest";

import { assertOutputSchema, type OutputSchemaName } from "../src/lib/output-schema.js";

const assertByName = assertOutputSchema as (name: OutputSchemaName, payload: unknown) => void;

describe("output schemas", () => {
  test("accepts the status contract and rejects stale or malformed payloads", () => {
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

    // A legacy V3 status payload must not satisfy the knowledge status contract.
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
  });

  test("the removed V3 runtime output contracts are no longer registered", () => {
    for (const name of ["fingerprint", "upgrade", "new", "adopt", "mv", "initState"]) {
      expect(() => assertByName(name as OutputSchemaName, {})).toThrow();
    }
  });
});
