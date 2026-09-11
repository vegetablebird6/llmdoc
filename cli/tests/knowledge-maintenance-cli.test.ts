import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 90000 });

import { createKnowledgeFixture, knowledgeDoc, makeTempDir, writeFile } from "./knowledge-helpers.js";
import { runCli } from "../src/cli.js";

async function withRegistryDir<T>(registryDir: string, run: () => T | Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
  const previous = process.env[key];
  process.env[key] = path.dirname(registryDir);
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

describe("knowledge maintenance CLI contracts", () => {
  test("capture/update/prune/migrate emit schema-valid --json payloads", async () => {
    const base = makeTempDir("llmdoc-maint-cli-");
    const registryDir = path.join(base, "config", "llmdoc");
    const fixture = await createKnowledgeFixture(
      "llmdoc-maint-cli-fixture-",
      { "src/api/retry.ts": "export const retry = 1;\n" },
      [{ id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }],
      { registryDir }
    );

    await withRegistryDir(registryDir, async () => {
      const capture = await runCli(["--json", "capture", "--source", fixture.source, "--title", "Idea", "--body", "# Idea\n"], fixture.source);
      expect(capture.exitCode).toBe(0);
      const captureJson = JSON.parse(capture.stdout) as { schema: string; candidateId: string };
      expect(captureJson.schema).toBe("llmdoc.capture/v1");
      expect(captureJson.candidateId).toMatch(/\.md$/);

      const update = await runCli(["--json", "update", "--source", fixture.source], fixture.source);
      expect(update.exitCode).toBe(0);
      const updateJson = JSON.parse(update.stdout) as { schema: string; candidates: Array<{ id: string }> };
      expect(updateJson.schema).toBe("llmdoc.update/v1");
      expect(updateJson.candidates.some((candidate) => candidate.id === captureJson.candidateId)).toBe(true);

      const reject = await runCli(
        ["--json", "update", "--source", fixture.source, "--reject", captureJson.candidateId],
        fixture.source
      );
      expect(reject.exitCode).toBe(0);
      expect((JSON.parse(reject.stdout) as { status: string }).status).toBe("prepared");

      const prune = await runCli(["--json", "prune", "--source", fixture.source, "--report"], fixture.source);
      expect(prune.exitCode).toBe(0);
      expect((JSON.parse(prune.stdout) as { schema: string }).schema).toBe("llmdoc.prune/v1");

      const legacyDir = path.join(base, "legacy");
      writeFile(
        legacyDir,
        "a.mdx",
        ["---", "description: Legacy", "kind: guide", "code:", "  paths:", "    - src/api/retry.ts", "---", "", "# Legacy", ""].join("\n")
      );
      const migrate = await runCli(
        ["--json", "migrate", "--source", fixture.source, "--legacy", legacyDir, "--knowledge", path.join(base, "migrated"), "--dry-run"],
        fixture.source
      );
      expect(migrate.exitCode).toBe(0);
      const migrateJson = JSON.parse(migrate.stdout) as { schema: string; status: string; targetRoot: string };
      expect(migrateJson.schema).toBe("llmdoc.migrate/v1");
      expect(migrateJson.status).toBe("dry_run");
      expect(fs.existsSync(migrateJson.targetRoot)).toBe(false);
    });
  });
});
