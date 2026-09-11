import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { assertOutputSchema } from "../src/lib/output-schema.js";
import { createFixture } from "./helpers.js";

describe("llmdoc cli", () => {
  test("all public json payloads validate through runtime output schemas", async () => {
    const rootDir = createFixture();
    const treeTopics = await runCli(["--json", "tree"], rootDir);
    expect(() => JSON.parse(treeTopics.stdout)).not.toThrow();
    const treeDocs = await runCli(["--json", "tree", "--docs"], rootDir);
    expect(() => JSON.parse(treeDocs.stdout)).not.toThrow();
    const index = await runCli(["--json", "index"], rootDir);
    expect(() => JSON.parse(index.stdout)).not.toThrow();
    const show = await runCli(["--json", "show", "api-client/overview.mdx"], rootDir);
    expect(() => JSON.parse(show.stdout)).not.toThrow();
    const search = await runCli(["--json", "search", "重试"], rootDir);
    expect(() => JSON.parse(search.stdout)).not.toThrow();
    const context = await runCli(["--json", "context", "--files", "src/api/retry.ts"], rootDir);
    expect(() => JSON.parse(context.stdout)).not.toThrow();
    const validate = await runCli(["--json", "validate"], rootDir);
    expect(() => JSON.parse(validate.stdout)).not.toThrow();
    const status = await runCli(["--json", "status"], rootDir);
    expect(() => JSON.parse(status.stdout)).not.toThrow();
    const delta = await runCli(["--json", "delta"], rootDir);
    expect(() => JSON.parse(delta.stdout)).not.toThrow();
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

  test("output schema validator rejects extra fields and wrong types", () => {
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
