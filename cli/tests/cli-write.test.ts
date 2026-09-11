import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { createFixture, readMeta, writeRepoFile } from "./helpers.js";

describe("llmdoc cli", () => {
  test("new scaffolds a document under llmdoc", async () => {
    const rootDir = createFixture();
    const result = await runCli(["new", "api-client/updating-hooks.mdx", "--kind", "guide"], rootDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("created");
    expect(fs.readFileSync(path.join(rootDir, "llmdoc", "api-client", "updating-hooks.mdx"), "utf8")).toContain("kind: guide");
  });

  test("new creates docs in fresh topics, syncs meta entry, and rejects invalid shapes or symlink escape", async () => {
    const rootDir = createFixture();
    const fresh = await runCli(["new", "fresh-topic/getting-started.mdx", "--kind", "guide"], rootDir);
    expect(fresh.exitCode).toBe(0);
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "fresh-topic", "getting-started.mdx"))).toBe(true);
    const meta = readMeta(rootDir);
    expect(meta.documents["fresh-topic/getting-started.mdx"]).toBeTruthy();
    expect(meta.documents["fresh-topic/getting-started.mdx"].validatedRevision).toBeNull();

    const indexName = await runCli(["new", "fresh-topic/index.mdx", "--kind", "guide"], rootDir);
    expect(indexName.exitCode).toBe(1);
    expect(indexName.stdout).toContain("does not use index.mdx");

    const invalidKind = await runCli(["new", "another.mdx", "--kind", "index"], rootDir);
    expect(invalidKind.exitCode).toBe(1);
    expect(invalidKind.stdout).toContain("Invalid kind");

    const nested = await runCli(["new", "topic/nested/file.mdx", "--kind", "guide"], rootDir);
    expect(nested.exitCode).toBe(1);
    expect(nested.stdout).toContain("topic/file depth");

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    fs.symlinkSync(outsideDir, path.join(rootDir, "llmdoc", "escape-topic"), process.platform === "win32" ? "junction" : "dir");
    const escaped = await runCli(["new", "escape-topic/file.mdx", "--kind", "guide"], rootDir);
    expect(escaped.exitCode).toBe(1);
    expect(escaped.stdout).toContain("escapes the repository");
  });

  test("mv uses git move and rewrites links plus meta ledger", async () => {
    const rootDir = createFixture();
    writeRepoFile(
      rootDir,
      "llmdoc.config.json",
      `${JSON.stringify(
        {
          schema: "llmdoc.config/v1",
          startup: {
            remindSkill: false,
            preload: ["architecture.mdx", "llmdoc/api-client/retry-policy.mdx"]
          }
        },
        null,
        2
      )}\n`
    );
    fs.appendFileSync(
      path.join(rootDir, "llmdoc", "api-client", "overview.mdx"),
      "\n[query link](./retry-policy.mdx?view=full#anchor)\n\n`[inline example](./retry-policy.mdx)`\n\n```md\n[fenced example](./retry-policy.mdx)\n```\n"
    );
    const result = await runCli(["mv", "api-client/retry-policy.mdx", "api-client/retry-strategy.mdx", "--json"], rootDir);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ rewrittenConfig: true });
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "api-client", "retry-strategy.mdx"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"))).toBe(false);

    const indexDoc = fs.readFileSync(path.join(rootDir, "llmdoc", "api-client", "overview.mdx"), "utf8");
    expect(indexDoc).toContain("retry-strategy.mdx");
    expect(indexDoc).toContain("retry-strategy.mdx?view=full#anchor");
    expect(indexDoc).toContain("`[inline example](./retry-policy.mdx)`");
    expect(indexDoc).toContain("[fenced example](./retry-policy.mdx)");

    const meta = JSON.parse(fs.readFileSync(path.join(rootDir, "llmdoc", "meta.json"), "utf8")) as {
      documents: Record<string, unknown>;
    };
    expect(meta.documents["api-client/retry-strategy.mdx"]).toBeTruthy();
    expect(meta.documents["api-client/retry-policy.mdx"]).toBeUndefined();

    const config = JSON.parse(fs.readFileSync(path.join(rootDir, "llmdoc.config.json"), "utf8")) as {
      startup: { preload: string[] };
    };
    expect(config.startup.preload).toEqual(["architecture.mdx", "llmdoc/api-client/retry-strategy.mdx"]);

    const validate = await runCli(["validate"], rootDir);
    expect(validate.exitCode).toBe(0);
    const commit = await runCli(["commit", "-m", "docs: move retry policy"], rootDir);
    expect(commit.exitCode).toBe(0);
  });

  test("mv rejects invalid targets before git mv runs", async () => {
    const rootDir = createFixture();
    const nested = await runCli(["mv", "api-client/retry-policy.mdx", "api-client/nested/retry-policy.mdx"], rootDir);
    expect(nested.exitCode).toBe(1);
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"))).toBe(true);

    const wrongIndex = await runCli(["mv", "api-client/retry-policy.mdx", "api-client/index.mdx"], rootDir);
    expect(wrongIndex.exitCode).toBe(1);
    expect(wrongIndex.stdout).toContain("does not use index.mdx");
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "api-client", "retry-policy.mdx"))).toBe(true);

    const metaMove = await runCli(["mv", "meta.json", "meta2.json"], rootDir);
    expect(metaMove.exitCode).toBe(1);
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "meta.json"))).toBe(true);

    // mv 到不存在的 topic 会自动创建目录(topic 即纯目录)
    const freshTopicMove = await runCli(["mv", "api-client/retry-policy.mdx", "other/retry-policy.mdx"], rootDir);
    expect(freshTopicMove.exitCode).toBe(0);
    expect(fs.existsSync(path.join(rootDir, "llmdoc", "other", "retry-policy.mdx"))).toBe(true);

    const existingTarget = await runCli(["mv", "api-client/error-model.mdx", "api-client/overview.mdx"], rootDir);
    expect(existingTarget.exitCode).toBe(1);
    expect(existingTarget.stdout).toContain("Target already exists");
  });

  test("mv stays correct when an ancestor directory is named llmdoc", async () => {
    // 回归 H1:仓库根(或祖先)目录名恰为 llmdoc 时,相对路径推导不能错位。
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-ancestor-"));
    const rootDir = path.join(parent, "llmdoc");
    fs.cpSync(createFixture(), rootDir, { recursive: true });

    const result = await runCli(["mv", "api-client/retry-policy.mdx", "api-client/retry-rules.mdx"], rootDir);
    expect(result.exitCode).toBe(0);

    const meta = readMeta(rootDir);
    expect(meta.documents["api-client/retry-rules.mdx"]).toBeTruthy();
    expect(meta.documents["api-client/retry-policy.mdx"]).toBeUndefined();
    const indexBody = fs.readFileSync(path.join(rootDir, "llmdoc", "api-client", "overview.mdx"), "utf8");
    expect(indexBody).toContain("retry-rules.mdx");
    expect(indexBody).not.toContain("retry-policy.mdx");

    const validated = await runCli(["validate"], rootDir);
    expect(validated.exitCode).toBe(0);
  });

  test("new escapes hostile descriptions into valid front matter", async () => {
    // 回归 M10:description 含引号/冒号/替换模式时仍要产出合法 YAML。
    const rootDir = createFixture();
    const hostile = `包含 "引号": 与 $& 替换模式`;
    const created = await runCli(["new", "api-client/hostile.mdx", "--kind", "guide", "--description", hostile], rootDir);
    expect(created.exitCode).toBe(0);

    const validated = await runCli(["validate"], rootDir);
    expect(validated.exitCode).toBe(0);

    const index = await runCli(["--json", "index", "--topic", "api-client"], rootDir);
    const payload = JSON.parse(index.stdout) as { documents: { path: string; description: string }[] };
    const doc = payload.documents.find((item) => item.path === "llmdoc/api-client/hostile.mdx");
    expect(doc?.description).toBe(hostile);
  });

  test("init-state seeds a null-revision ledger and refuses to overwrite", async () => {
    const rootDir = createFixture();
    fs.rmSync(path.join(rootDir, "llmdoc", "meta.json"));

    const seeded = await runCli(["--json", "init-state"], rootDir);
    expect(seeded.exitCode).toBe(0);
    const payload = JSON.parse(seeded.stdout) as { status: string; documents: number; next: string };
    expect(payload.status).toBe("success");
    expect(payload.documents).toBe(4);
    const meta = readMeta(rootDir);
    expect(meta.documents["api-client/retry-policy.mdx"].validatedRevision).toBeNull();

    const refused = await runCli(["init-state"], rootDir);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toContain("already exists");
  });

  test("adopt registers existing mdx into meta.json losslessly and idempotently", async () => {
    const rootDir = createFixture();
    const docPath = path.join(rootDir, "llmdoc", "api-client", "adopt-repro.mdx");
    const body = "---\ndescription: 已由外部流程写好的合法文档。\nkind: reference\n---\n\n# Adopt repro\n\n正文内容。\n";
    fs.writeFileSync(docPath, body);

    const invalid = await runCli(["validate"], rootDir);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout).toContain("meta.entry.missing");
    expect(invalid.stdout).toContain("llmdoc adopt");

    const result = await runCli(["--json", "adopt", "api-client/adopt-repro.mdx"], rootDir);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { adopted: string[]; alreadyRegistered: string[] };
    expect(payload.adopted).toEqual(["api-client/adopt-repro.mdx"]);
    expect(fs.readFileSync(docPath, "utf8")).toBe(body);
    const meta = readMeta(rootDir);
    expect(meta.documents["api-client/adopt-repro.mdx"].validatedRevision).toBeNull();

    const valid = await runCli(["validate"], rootDir);
    expect(valid.exitCode).toBe(0);

    const again = await runCli(["--json", "adopt", "api-client/adopt-repro.mdx"], rootDir);
    expect(again.exitCode).toBe(0);
    const againPayload = JSON.parse(again.stdout) as { adopted: string[]; alreadyRegistered: string[] };
    expect(againPayload.adopted).toEqual([]);
    expect(againPayload.alreadyRegistered).toEqual(["api-client/adopt-repro.mdx"]);

    const missing = await runCli(["adopt", "api-client/not-there.mdx"], rootDir);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toContain("Target does not exist");
  });
});
