import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const srcRoot = path.resolve(__dirname, "..", "src");
const schemasRoot = path.resolve(__dirname, "..", "schemas");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(absolute);
    }
  }
  return files;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

const files = sourceFiles(srcRoot);

describe("runtime surface regression scans", () => {
  test("no v3-ng/ng runtime namespace survives (frozen meta schema id excepted)", () => {
    for (const file of files) {
      const relative = path.relative(srcRoot, file).replaceAll(path.sep, "/");
      const content = fs.readFileSync(file, "utf8").replaceAll("llmdoc.meta/v3-ng", "llmdoc.meta/<meta>");
      expect(content, relative).not.toMatch(/v3-?ng/i);
      expect(content, relative).not.toMatch(/\bv3ng\b/i);
      expect(content, relative).not.toMatch(/\brunNg\b/);
      expect(content, relative).not.toMatch(/\bng[A-Z]/);
      expect(content, relative).not.toMatch(/lib\/v3ng/);
      expect(content, relative).not.toMatch(/llmdoc\.ng-/);
    }
  });

  test("removed V3 runtime commands are not registered and the current surface is present", () => {
    const cli = read("cli.ts");
    for (const command of ["new", "adopt", "mv", "fingerprint", "init-state", "upgrade"]) {
      expect(cli).not.toMatch(new RegExp(`\\.command\\(["'\`]${command}`));
    }
    for (const command of [
      "tree",
      "index",
      "show",
      "search",
      "context",
      "validate",
      "status",
      "delta",
      "review",
      "commit",
      "capture",
      "update",
      "prune",
      "migrate",
      "bind",
      "init",
      "hook",
      "serve"
    ]) {
      expect(cli, command).toMatch(new RegExp(`\\.command\\(["'\`]${command}`));
    }
  });

  test("legacy V3 parsing is reachable only from the explicit migrate command", () => {
    for (const file of files) {
      const relative = path.relative(srcRoot, file).replaceAll(path.sep, "/");
      if (relative === "lib/knowledge/migrate.ts") {
        continue;
      }
      expect(fs.readFileSync(file, "utf8"), relative).not.toMatch(/legacy\.js/);
    }
  });

  test("dormant V3 API exports stay removed", () => {
    expect(read("types.ts")).not.toMatch(
      /WorkspaceData|ParsedDocument|DocumentFrontmatter|MetaLedger|LlmdocConfig|GitState|DocumentImpact|DocumentKind|CodeRef/
    );
    expect(read("lib/search.ts")).not.toMatch(/searchDocuments/);
    expect(read("lib/markdown.ts")).not.toMatch(/validateCodeRefTags/);
  });

  test("the obsolete config schema is gone and the knowledge layout schema is the published source", () => {
    expect(fs.existsSync(path.join(schemasRoot, "config.schema.json"))).toBe(false);
    const knowledge = JSON.parse(fs.readFileSync(path.join(schemasRoot, "knowledge.schema.json"), "utf8")) as {
      properties?: Record<string, unknown>;
    };
    expect(knowledge.properties?.schema).toEqual({ const: "llmdoc.knowledge/v1" });
  });
});
