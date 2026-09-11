import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 90000 });

import { runCli } from "../src/cli.js";
import { commitFile, createKnowledgeFixture, initRepo, knowledgeDoc, makeTempDir, writeFile } from "./knowledge-helpers.js";

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

function registryEnvKey(): string {
  return process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
}

describe("knowledge CLI review/commit surface", () => {
  it("runs review, confirm, commit, status, delta and validate end to end", async () => {
    const registryBase = makeTempDir("llmdoc-cli-surface-");
    createdDirs.push(registryBase);
    const previous = process.env[registryEnvKey()];
    process.env[registryEnvKey()] = registryBase;
    try {
      const fixture = await createKnowledgeFixture(
        "llmdoc-cli-surface-fix-",
        { "src/a.ts": "export const a = 1;\n" },
        [{ id: "a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n" }), scope: ["src/a.ts"] }],
        { registryDir: path.join(registryBase, "llmdoc") }
      );
      createdDirs.push(fixture.base);
      writeFile(fixture.knowledgeRoot, "docs/a.md", knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n\nchanged\n" }));

      const common = ["--source", fixture.source, "--knowledge", fixture.knowledgeRoot];
      const review = await runCli(["--json", "review", ...common]);
      expect(review.exitCode).toBe(0);
      const reviewPayload = JSON.parse(review.stdout) as { reviewId: string; status: string; confirmed: boolean };
      expect(reviewPayload.status).toBe("generated");
      expect(reviewPayload.confirmed).toBe(false);

      const confirm = await runCli(["--json", "review", "--confirm", reviewPayload.reviewId, ...common]);
      expect(confirm.exitCode).toBe(0);
      expect((JSON.parse(confirm.stdout) as { confirmed: boolean }).confirmed).toBe(true);

      const commit = await runCli(["--json", "commit", "--review", reviewPayload.reviewId, ...common]);
      expect(commit.exitCode).toBe(0);
      const commitPayload = JSON.parse(commit.stdout) as { status: string; changedDocuments: string[]; knowledgeRevision: string; cleanupRequired: boolean };
      expect(commitPayload.status).toBe("success");
      expect(commitPayload.changedDocuments).toEqual(["a.md"]);
      expect(commitPayload.cleanupRequired).toBe(false);

      const status = await runCli(["--json", "status", ...common]);
      expect(status.exitCode).toBe(0);
      expect((JSON.parse(status.stdout) as { documents: { current: number } }).documents.current).toBe(1);

      const delta = await runCli(["--json", "delta", ...common]);
      expect(delta.exitCode).toBe(0);
      expect((JSON.parse(delta.stdout) as { suggestedMode: string }).suggestedMode).toBe("light");

      const validate = await runCli(["--json", "validate", ...common]);
      expect(validate.exitCode).toBe(0);
      expect((JSON.parse(validate.stdout) as { ok: boolean }).ok).toBe(true);

      const duplicate = await runCli(["--json", "commit", "--review", reviewPayload.reviewId, ...common]);
      expect(duplicate.exitCode).toBe(3);
      expect((JSON.parse(duplicate.stdout) as { error: { code: string } }).error.code).toBe("E_REVIEW_INVALIDATED");
    } finally {
      if (previous === undefined) {
        delete process.env[registryEnvKey()];
      } else {
        process.env[registryEnvKey()] = previous;
      }
    }
  });

  it("fails with a stable binding error when no precise binding exists", async () => {
    const registryBase = makeTempDir("llmdoc-cli-unbound-");
    createdDirs.push(registryBase);
    const sourceBase = makeTempDir("llmdoc-cli-unbound-src-");
    createdDirs.push(sourceBase);
    const source = initRepo(path.join(sourceBase, "source"));
    commitFile(source, "src/main.ts", "export {}\n", "init");
    const previous = process.env[registryEnvKey()];
    process.env[registryEnvKey()] = registryBase;
    try {
      const result = await runCli(["--json", "status", "--source", source]);
      expect(result.exitCode).toBe(2);
      expect((JSON.parse(result.stdout) as { error: { code: string } }).error.code).toBe("E_BINDING_NOT_FOUND");
    } finally {
      if (previous === undefined) {
        delete process.env[registryEnvKey()];
      } else {
        process.env[registryEnvKey()] = previous;
      }
    }
  });

  it("rejects malformed or unknown review ids through the CLI without writing outside the knowledge root", async () => {
    const registryBase = makeTempDir("llmdoc-cli-reviewid-");
    createdDirs.push(registryBase);
    const previous = process.env[registryEnvKey()];
    process.env[registryEnvKey()] = registryBase;
    try {
      const fixture = await createKnowledgeFixture(
        "llmdoc-cli-reviewid-fix-",
        { "src/a.ts": "export const a = 1;\n" },
        [{ id: "a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n" }), scope: ["src/a.ts"] }],
        { registryDir: path.join(registryBase, "llmdoc") }
      );
      createdDirs.push(fixture.base);
      const common = ["--source", fixture.source, "--knowledge", fixture.knowledgeRoot];

      for (const badId of ["../evil", "..\\evil", "not-hex"]) {
        const confirm = await runCli(["--json", "review", "--confirm", badId, ...common]);
        expect(confirm.exitCode).toBe(2);
        expect((JSON.parse(confirm.stdout) as { error: { code: string } }).error.code).toBe("E_REVIEW_INVALID");
        const commit = await runCli(["--json", "commit", "--review", badId, ...common]);
        expect(commit.exitCode).toBe(2);
        expect((JSON.parse(commit.stdout) as { error: { code: string } }).error.code).toBe("E_REVIEW_INVALID");
      }
      expect(fs.existsSync(path.join(fixture.base, "evil.json"))).toBe(false);

      const unknown = await runCli(["--json", "review", "--confirm", "a".repeat(32), ...common]);
      expect(unknown.exitCode).toBe(2);
      expect((JSON.parse(unknown.stdout) as { error: { code: string } }).error.code).toBe("E_REVIEW_NOT_FOUND");
    } finally {
      if (previous === undefined) {
        delete process.env[registryEnvKey()];
      } else {
        process.env[registryEnvKey()] = previous;
      }
    }
  });
});
