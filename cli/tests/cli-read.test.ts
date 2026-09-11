import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { createFixture, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("tree, index, show, search and context expose progressive disclosure surfaces", async () => {
    const rootDir = createFixture();

    const tree = await runCli(["tree"], rootDir);
    expect(tree.stdout).toContain("api-client/");
    expect(tree.stdout).toContain("architecture.mdx");

    const treePage1 = await runCli(["tree", "--limit", "1", "--json"], rootDir);
    const treePage1Json = JSON.parse(treePage1.stdout) as {
      rootSingletons: Array<{ path: string }>;
      topics: Array<{ topic: string }>;
      pagination: { totalItems: number; returnedItems: number; nextCursor: string | null };
    };
    expect(treePage1Json.rootSingletons.map((item) => item.path)).toEqual(["llmdoc/architecture.mdx"]);
    expect(treePage1Json.topics).toEqual([]);
    expect(treePage1Json.pagination.totalItems).toBe(2);
    expect(treePage1Json.pagination.returnedItems).toBe(1);
    expect(treePage1Json.pagination.nextCursor).not.toBeNull();

    const treePage2 = await runCli(["tree", "--limit", "1", "--cursor", treePage1Json.pagination.nextCursor!, "--json"], rootDir);
    const treePage2Json = JSON.parse(treePage2.stdout) as {
      rootSingletons: Array<{ path: string }>;
      topics: Array<{ topic: string }>;
      pagination: { totalItems: number; returnedItems: number; nextCursor: string | null };
    };
    expect(treePage2Json.rootSingletons).toEqual([]);
    expect(treePage2Json.topics.map((item) => item.topic)).toEqual(["api-client"]);
    expect(treePage2Json.pagination.totalItems).toBe(2);
    expect(treePage2Json.pagination.returnedItems).toBe(1);
    expect(treePage2Json.pagination.nextCursor).toBeNull();

    const index = await runCli(["index", "--topic", "api-client"], rootDir);
    expect(index.stdout).toContain("retry-policy.mdx");
    expect(index.stdout).toContain("code.paths");

    const show = await runCli(["show", "api-client/retry-policy.mdx"], rootDir);
    expect(show.stdout).toContain("请求重试策略");

    const search = await runCli(["search", "重试"], rootDir);
    expect(search.stdout).toContain("retry-policy.mdx");
    expect(fs.existsSync(path.join(rootDir, ".llmdoc-tmp", "cache", "search-index.json"))).toBe(true);

    const context = await runCli(["context", "--files", "src/api/retry.ts"], rootDir);
    expect(context.stdout).toContain("retry-policy.mdx");
    expect(context.stdout).toContain("requires -> llmdoc/api-client/error-model.mdx");
  });

  test("show rejects symlink escape paths", async () => {
    const rootDir = createFixture({ withSymlinkEscape: true });
    const result = await runCli(["show", "escape/secret.mdx"], rootDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Document does not exist");
  });

  test("workspace loading rejects an llmdoc root symlink that escapes the repository", async () => {
    const rootDir = createFixture();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-outside-root-"));
    const externalLlmdoc = path.join(outsideDir, "llmdoc");
    fs.cpSync(path.join(rootDir, "llmdoc"), externalLlmdoc, { recursive: true });
    fs.rmSync(path.join(rootDir, "llmdoc"), { recursive: true });
    fs.symlinkSync(externalLlmdoc, path.join(rootDir, "llmdoc"), process.platform === "win32" ? "junction" : "dir");

    const result = await runCli(["tree"], rootDir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("through a symlink");
  });

  test("context validates file inputs and paginates instead of silently truncating", async () => {
    const rootDir = createFixture();
    const result = await runCli(["context", "--files", "src/api/retry.ts", "--budget", "1"], rootDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("cursor:");

    const invalid = await runCli(["context", "--files", "../outside.ts"], rootDir);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout).toContain("normalized repository-relative path");
  });

  test("context reports mapped and unmapped inputs independently", async () => {
    const rootDir = createFixture();

    const mapped = await runCli(["--json", "context", "--files", "src/api/retry.ts"], rootDir);
    expect(mapped.exitCode).toBe(0);
    const mappedPayload = JSON.parse(mapped.stdout) as {
      impacted: Array<{ path: string }>;
      unmappedFiles: string[];
    };
    expect(mappedPayload.impacted.some((document) => document.path === "llmdoc/api-client/retry-policy.mdx")).toBe(true);
    expect(mappedPayload.unmappedFiles).toEqual([]);

    const unmapped = await runCli(["--json", "context", "--files", "src/api/new-feature.ts"], rootDir);
    expect(unmapped.exitCode).toBe(0);
    const unmappedPayload = JSON.parse(unmapped.stdout) as {
      impacted: Array<{ path: string }>;
      prerequisites: Array<{ path: string }>;
      unmappedFiles: string[];
    };
    expect(unmappedPayload.impacted).toEqual([]);
    expect(unmappedPayload.prerequisites).toEqual([]);
    expect(unmappedPayload.unmappedFiles).toEqual(["src/api/new-feature.ts"]);

    const mixedJson = await runCli(
      [
        "--json",
        "context",
        "--files",
        "src/api/retry.ts",
        "src/api/new-feature.ts",
        "src/core/unmapped.ts"
      ],
      rootDir
    );
    expect(mixedJson.exitCode).toBe(0);
    const mixedPayload = JSON.parse(mixedJson.stdout) as {
      impacted: Array<{ path: string }>;
      unmappedFiles: string[];
    };
    expect(mixedPayload.impacted.some((document) => document.path === "llmdoc/api-client/retry-policy.mdx")).toBe(
      true
    );
    expect(mixedPayload.unmappedFiles).toEqual(["src/api/new-feature.ts", "src/core/unmapped.ts"]);

    const mixed = await runCli(["context", "--files", "src/api/retry.ts", "src/api/new-feature.ts"], rootDir);
    expect(mixed.exitCode).toBe(0);
    expect(mixed.stdout).toContain("retry-policy.mdx");
    expect(mixed.stdout).toContain("unmapped files: 1");
    expect(mixed.stdout).toContain("unmapped -> src/api/new-feature.ts");
  });

  test("metadata commands budget their projected output instead of full document bodies", async () => {
    const rootDir = createFixture();
    fs.appendFileSync(path.join(rootDir, "llmdoc", "api-client", "overview.mdx"), `\n${"large body ".repeat(4000)}`);

    const index = await runCli(["index", "--topic", "api-client", "--budget", "500", "--json"], rootDir);
    const payload = JSON.parse(index.stdout) as {
      documents: unknown[];
      pagination: { totalItems: number; returnedItems: number; totalEstimatedTokens: number; nextCursor: string | null };
    };

    expect(payload.pagination.totalItems).toBe(3);
    expect(payload.pagination.returnedItems).toBe(3);
    expect(payload.pagination.totalEstimatedTokens).toBeLessThan(500);
    expect(payload.pagination.nextCursor).toBeNull();
    expect(payload.documents).toHaveLength(3);

    const malformedCursor = Buffer.from(JSON.stringify({ offset: "0" })).toString("base64url");
    const invalid = await runCli(["index", "--cursor", malformedCursor], rootDir);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout).toContain("cursor is invalid");
  });

  test("json pagination omits raw items and show body appears only once", async () => {
    const rootDir = createFixture();
    const search = await runCli(["search", "重试", "--json"], rootDir);
    expect(search.stdout).not.toContain("absolutePath");
    expect(search.stdout).not.toContain("\"raw\"");
    const searchJson = JSON.parse(search.stdout) as { pagination: { totalItems: number; nextCursor: string | null } };
    expect(searchJson.pagination.totalItems).toBeGreaterThan(0);

    const show = await runCli(["--json", "show", "api-client/retry-policy.mdx"], rootDir);
    const showJson = JSON.parse(show.stdout) as { documents: Array<{ body: string }>; pagination: { returnedItems: number } };
    expect(show.stdout.match(/幂等 GET 之外的请求默认不重试/g)?.length).toBe(1);
    expect(showJson.pagination.returnedItems).toBe(1);
  });

  test("scope, kind, CodeRef, glob prefix and search cache degraded paths are enforced", async () => {
    const rootDir = createFixture();

    const badScope = await runCli(["delta", "--scope", "missing-topic"], rootDir);
    expect(badScope.exitCode).toBe(1);
    expect(badScope.stdout).toContain("Scope did not match");

    const badFingerprint = await runCli(["fingerprint", "--all", "--update", "api-client/overview.mdx"], rootDir);
    expect(badFingerprint.exitCode).toBe(1);
    expect(badFingerprint.stdout).toContain("cannot use --all and --update together");

    const badKindIndex = await runCli(["index", "--kind", "bad-kind"], rootDir);
    expect(badKindIndex.exitCode).toBe(1);
    expect(badKindIndex.stdout).toContain("Invalid kind");

    const badKindSearch = await runCli(["search", "重试", "--kind", "bad-kind"], rootDir);
    expect(badKindSearch.exitCode).toBe(1);
    expect(badKindSearch.stdout).toContain("Invalid kind");

    writeRepoFile(
      rootDir,
      "llmdoc/api-client/coderef-rules.mdx",
      `---
description: CodeRef rules.
kind: guide
code:
  paths:
    - src/*/foo.ts
---

# CodeRef Rules

\`\`\`mdx
<CodeRef symbol="fake" />
[fake](./missing.mdx)
{fake()}
\`\`\`

\`<CodeRef path="src/missing.ts" foo="x" />\`

<CodeRef symbol="dup" path="src/api/retry.ts" foo="x" />
`
    );
    const metaPath = path.join(rootDir, "llmdoc", "meta.json");
    const metaForRules = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      schema: string;
      baseline: { revision: string; verifiedAt: string };
      documents: Record<string, { validatedRevision: string }>;
      convergence: { capturedAt: string; source: string; documentCount: number; totalEstimatedTokens: number };
    };
    metaForRules.documents["api-client/coderef-rules.mdx"] = { validatedRevision: metaForRules.baseline.revision };
    fs.writeFileSync(metaPath, `${JSON.stringify(metaForRules, null, 2)}\n`);
    writeRepoFile(rootDir, "src/team/foo.ts", "export const foo = true;\n");
    const validate = await runCli(["validate"], rootDir);
    expect(validate.exitCode).toBe(1);
    expect(validate.stdout).toContain("CodeRef contains an unknown attribute");
    expect(validate.stdout).not.toContain("Body link points to a missing document: ./missing.mdx");
    expect(validate.stdout).not.toContain("MDX/JS expressions are forbidden");
    expect(validate.stdout).not.toContain("code.paths points to a missing path: src/*/foo.ts");

    const tmpEscape = fs.mkdtempSync(path.join(rootDir, "tmp-escape-"));
    fs.symlinkSync(tmpEscape, path.join(rootDir, ".llmdoc-tmp"), process.platform === "win32" ? "junction" : "dir");
    const searchWithSymlink = await runCli(["search", "重试"], rootDir);
    expect(searchWithSymlink.exitCode).toBe(0);
    expect(searchWithSymlink.stdout).toContain("retry-policy.mdx");

    fs.rmSync(path.join(rootDir, ".llmdoc-tmp"), { force: true });
    fs.mkdirSync(path.join(rootDir, ".llmdoc-tmp", "cache"), { recursive: true });
    fs.chmodSync(path.join(rootDir, ".llmdoc-tmp"), 0o555);
    const searchReadOnly = await runCli(["search", "重试"], rootDir);
    expect(searchReadOnly.exitCode).toBe(0);
    expect(searchReadOnly.stdout).toContain("retry-policy.mdx");
  });

  test("dot-prefixed code.paths still map to documents", async () => {
    // 回归 H3:front matter 里写 ./src/... 不能让文档静默脱离影响面。
    const rootDir = createFixture();
    fs.writeFileSync(
      path.join(rootDir, "llmdoc", "architecture.mdx"),
      `---
description: 整体架构与关键引导。
kind: architecture
code:
  paths:
    - ./src/api/retry.ts
---

# 整体架构

`
    );

    const context = await runCli(["--json", "context", "--files", "src/api/retry.ts"], rootDir);
    const payload = JSON.parse(context.stdout) as { impacted: { path: string }[] };
    expect(payload.impacted.some((item) => item.path === "llmdoc/architecture.mdx")).toBe(true);
  });

  test("invalid global option values fail cleanly instead of crashing", async () => {
    const rootDir = createFixture();
    const result = await runCli(["tree", "--limit", "abc"], rootDir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Invalid integer");
  });
});
