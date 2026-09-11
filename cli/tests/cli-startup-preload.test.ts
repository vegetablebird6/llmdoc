import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { createFixture, legacyValidationIssues, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("startup config deduplicates normalized preload aliases with a warning", async () => {
    const rootDir = createFixture();
    writeRepoFile(
      rootDir,
      "llmdoc.config.json",
      `${JSON.stringify(
        {
          schema: "llmdoc.config/v1",
          startup: { remindSkill: false, preload: ["architecture.mdx", "llmdoc/architecture.mdx"] }
        },
        null,
        2
      )}\n`
    );

    const validate = legacyValidationIssues(rootDir);
    expect(validate.some((issue) => issue.code === "config.startup.preload.duplicate")).toBe(true);

    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.stdout).not.toContain("Operating guidance:");
    expect(sessionStart.stdout).toContain("normalized duplicate startup.preload entries were ignored");
    expect(sessionStart.stdout.match(/=== llmdoc\/architecture\.mdx \[architecture\] \(startup preload\) ===/g)).toHaveLength(1);
  });

  test("startup preload has no character or token budget", async () => {
    const rootDir = createFixture();
    const marker = "UNBOUNDED_STARTUP_CONTEXT_END";
    fs.appendFileSync(
      path.join(rootDir, "llmdoc", "architecture.mdx"),
      `\n${"large startup context ".repeat(1_000)}${marker}\n`
    );
    writeRepoFile(
      rootDir,
      "llmdoc.config.json",
      `${JSON.stringify(
        { schema: "llmdoc.config/v1", startup: { remindSkill: false, preload: ["architecture.mdx"] } },
        null,
        2
      )}\n`
    );

    const validate = legacyValidationIssues(rootDir);
    expect(validate.filter((issue) => issue.severity === "error")).toEqual([]);

    const sessionStart = await runCli(["hook", "session-start"], rootDir);
    expect(sessionStart.exitCode).toBe(0);
    expect(sessionStart.stdout).toContain(marker);
    expect(sessionStart.stdout).toContain("=== llmdoc startup preload complete ===");
  });
});
