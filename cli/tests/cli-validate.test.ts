import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { createFixture } from "./helpers.js";

describe("llmdoc cli", () => {
  test("validate passes on a valid v3 workspace", async () => {
    const rootDir = createFixture();
    const result = await runCli(["validate"], rootDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("validate: ok");
  });

  test("validate reports dangling links and ledger mismatch", async () => {
    const danglingRoot = createFixture({ broken: "dangling-link" });
    const danglingResult = await runCli(["validate"], danglingRoot);
    expect(danglingResult.exitCode).toBe(1);
    expect(danglingResult.stdout).toContain("link.missing");

    const mismatchRoot = createFixture({ broken: "meta-mismatch" });
    const mismatchResult = await runCli(["validate"], mismatchRoot);
    expect(mismatchResult.exitCode).toBe(1);
    expect(mismatchResult.stdout).toContain("meta.entry.missing");
  });

  test("validate reports invalid yaml/json, forbidden mdx syntax, stray files, and bad git revisions as issues", async () => {
    const invalidYamlRoot = createFixture({ broken: "invalid-yaml" });
    const invalidYamlResult = await runCli(["validate"], invalidYamlRoot);
    expect(invalidYamlResult.exitCode).toBe(1);
    expect(invalidYamlResult.stdout).toContain("frontmatter.parse");

    const invalidJsonRoot = createFixture({ broken: "invalid-meta-json" });
    const invalidJsonResult = await runCli(["validate"], invalidJsonRoot);
    expect(invalidJsonResult.exitCode).toBe(1);
    expect(invalidJsonResult.stdout).toContain("meta.parse");

    const forbiddenMdxRoot = createFixture({ broken: "forbidden-jsx" });
    const forbiddenMdxResult = await runCli(["validate"], forbiddenMdxRoot);
    expect(forbiddenMdxResult.exitCode).toBe(1);
    expect(forbiddenMdxResult.stdout).toContain("mdx.syntax.forbidden");

    const strayFileRoot = createFixture({ broken: "non-mdx-file" });
    const strayFileResult = await runCli(["validate"], strayFileRoot);
    expect(strayFileResult.exitCode).toBe(1);
    expect(strayFileResult.stdout).toContain("file.extension.invalid");

    const badRevisionRoot = createFixture({ broken: "invalid-revision" });
    const badRevisionResult = await runCli(["validate"], badRevisionRoot);
    expect(badRevisionResult.exitCode).toBe(1);
    expect(badRevisionResult.stdout).toContain("meta.baseline.revision.missing");
    expect(badRevisionResult.stdout).toContain("meta.document.revision.missing");

    const invalidTimestampRoot = createFixture({ broken: "invalid-timestamp" });
    const invalidTimestampResult = await runCli(["validate"], invalidTimestampRoot);
    expect(invalidTimestampResult.exitCode).toBe(1);
    expect(invalidTimestampResult.stdout).toContain("meta.invalid");
  });

  test("validate rejects a code.paths glob whose existing static prefix has zero file matches", async () => {
    const rootDir = createFixture();
    fs.writeFileSync(
      path.join(rootDir, "llmdoc", "architecture.mdx"),
      `---
description: 整体架构与关键引导。
kind: architecture
code:
  paths:
    - src/api/*.tsx
---

# 整体架构
`
    );

    const result = await runCli(["validate"], rootDir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("code.paths.unmatched");
    expect(result.stdout).toContain("src/api/*.tsx");
  });

  test("validate warns on wikilink syntax", async () => {
    const rootDir = createFixture();
    fs.appendFileSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"), "\n另见 [[api-client/error-model]]。\n");
    const result = await runCli(["validate"], rootDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("link.wikilink");
  });
});
