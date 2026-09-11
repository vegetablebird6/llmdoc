import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { commitAll, createFixture, legacyValidationIssues, writeRepoFile } from "./helpers.js";
import { loadWorkspace } from "../src/lib/workspace.js";
import { analyzeDelta } from "../src/lib/state.js";
import { readRepositoryRevisionHealth } from "../src/lib/repository-health.js";

describe("llmdoc cli", () => {
  test("session-start follows startup config for skill reminders and direct document preload", async () => {
    const rootDir = createFixture();
    writeRepoFile(
      rootDir,
      "llmdoc.config.json",
      `${JSON.stringify(
        {
          schema: "llmdoc.config/v1",
          startup: {
            remindSkill: true,
            preload: ["architecture.mdx", "llmdoc/api-client/error-model.mdx"]
          }
        },
        null,
        2
      )}\n`
    );

    const validate = legacyValidationIssues(rootDir);
    expect(validate.filter((issue) => issue.severity === "error")).toEqual([]);

    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.exitCode).toBe(0);
    expect(sessionStart.stdout).toContain("Operating guidance:");
    expect(sessionStart.stdout).toContain("llmdoc skill");
    expect(sessionStart.stdout).toContain("investigator");
    expect(sessionStart.stdout).toContain("startup preload begins (2 document(s))");
    expect(sessionStart.stdout).toContain("do not need another search/show");
    expect(sessionStart.stdout).toContain("=== llmdoc/architecture.mdx [architecture] (startup preload) ===");
    expect(sessionStart.stdout).toContain("=== llmdoc/api-client/error-model.mdx [reference] (startup preload) ===");
    expect(sessionStart.stdout).toContain("# 错误模型");
    expect(sessionStart.stdout).toContain("=== llmdoc startup preload complete ===");

    const compactReentry = await runCli(["hook", "session-start"], rootDir, JSON.stringify({ source: "compact" }));
    expect(compactReentry.stdout).toContain("compact re-entry");
    expect(compactReentry.stdout).toContain("startup preload bodies were not re-injected after compaction");
    expect(compactReentry.stdout).toContain("llmdoc/api-client/error-model.mdx");
    expect(compactReentry.stdout).not.toContain("# 错误模型");
    expect(compactReentry.stdout).not.toContain("startup preload complete");

    const delta = analyzeDelta(loadWorkspace(rootDir));
    expect(delta.unmappedDirtyPaths).not.toContain("llmdoc.config.json");

    commitAll(rootDir, "configure llmdoc startup context");
    const after = loadWorkspace(rootDir);
    const afterDelta = analyzeDelta(after);
    const health = readRepositoryRevisionHealth(after.rootDir, after.meta?.baseline.revision ?? null, afterDelta.git);
    expect(health.relevantCommitsBehindHead).toBe(0);
    const configOnlySessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(configOnlySessionStart.stdout).toContain("documents have no actionable impacts");
    expect(configOnlySessionStart.stdout).not.toContain("behind HEAD");
  });

  test("startup config can keep the skill reminder disabled", async () => {
    const rootDir = createFixture();
    writeRepoFile(
      rootDir,
      "llmdoc.config.json",
      `${JSON.stringify(
        {
          schema: "llmdoc.config/v1",
          startup: { remindSkill: false, preload: ["api-client/error-model.mdx"] }
        },
        null,
        2
      )}\n`
    );

    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.stdout).not.toContain("Operating guidance:");
    expect(sessionStart.stdout).not.toContain("llmdoc skill");
    expect(sessionStart.stdout).toContain("# 错误模型");
    expect(sessionStart.stdout).toContain("startup preload complete");
  });

  test("validate rejects invalid startup config while session-start stays fail-open", async () => {
    const rootDir = createFixture();
    writeRepoFile(
      rootDir,
      "llmdoc.config.json",
      `${JSON.stringify(
        {
          schema: "llmdoc.config/v1",
          startup: { remindSkill: false, preload: ["api-client/missing.mdx"] }
        },
        null,
        2
      )}\n`
    );

    const validate = legacyValidationIssues(rootDir);
    expect(validate.some((issue) => issue.code === "config.startup.preload.missing")).toBe(true);
    expect(validate.map((issue) => issue.message).join("\n")).not.toMatch(/[\p{Script=Han}]/u);

    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.exitCode).toBe(0);
    expect(sessionStart.stdout).toContain("invalid startup.preload entries");
    expect(sessionStart.stdout).toContain("valid remindSkill preference remained applied");
    expect(sessionStart.stdout).not.toContain("Operating guidance:");
    expect(sessionStart.stdout).not.toContain("startup preload begins");

    const invalidSchemaRoot = createFixture();
    writeRepoFile(
      invalidSchemaRoot,
      "llmdoc.config.json",
      `${JSON.stringify(
        {
          schema: "llmdoc.config/v0",
          startup: { remindSkill: false, preload: ["architecture.mdx"] }
        },
        null,
        2
      )}\n`
    );
    const invalidSchemaSession = await runCli(["hook", "session-start"], invalidSchemaRoot);
    expect(invalidSchemaSession.stdout).toContain("llmdoc.config.json could not be applied");
    expect(invalidSchemaSession.stdout).toContain("default skill reminder remains active");
    expect(invalidSchemaSession.stdout).toContain("Operating guidance:");
    expect(invalidSchemaSession.stdout).not.toContain("startup preload begins");
  });
});
