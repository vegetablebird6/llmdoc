import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60000 });

import { runCli } from "../src/cli.js";
import { runHook } from "../src/commands/hook.js";
import { runKnowledgeHook, isKnowledgeHookEvent } from "../src/lib/knowledge/hook.js";
import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import {
  createKnowledgeFixture,
  git,
  knowledgeDoc,
  makeTempDir,
  snapshotWorktree,
  sourceIndexBytes,
  head
} from "./knowledge-helpers.js";

const createdDirs: string[] = [];

function track(dir: string): string {
  createdDirs.push(dir);
  return dir;
}

beforeAll(() => {
  expect(isKnowledgeHookEvent("session-start")).toBe(true);
  expect(isKnowledgeHookEvent("nope")).toBe(false);
});

afterAll(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("knowledge hook (fail-open, read-only)", () => {
  it("reports bound review obligations without writing source or knowledge", async () => {
    const fixture = await createKnowledgeFixture(
      "llmdoc-hook-",
      { "src/api/retry.ts": "export const retry = 1;\n", "src/db/pool.ts": "export const pool = 1;\n" },
      [
        { id: "architecture.md", content: knowledgeDoc("architecture", "Retry architecture", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] },
        { id: "guides/db.md", content: knowledgeDoc("guide", "Database pool", { paths: ["src/db/pool.ts"] }), scope: ["src/db/pool.ts"] }
      ]
    );
    track(fixture.base);
    const sourceBefore = snapshotWorktree(fixture.source);
    const indexBefore = sourceIndexBytes(fixture.source);
    const knowledgeBefore = snapshotWorktree(fixture.knowledgeRoot);

    const result = await runKnowledgeHook({ cwd: fixture.source, event: "session-start", registryDir: fixture.registryDir });
    expect(result.payload.mode).toBe("bound");
    expect(result.payload.repositoryId).toBe(fixture.repositoryId);
    expect(result.payload.knowledgeRevision).toBe(fixture.knowledgeHead);
    expect(result.payload.sourceRevision).toBe(fixture.sourceHead);
    expect(result.payload.documents.total).toBe(2);
    expect(result.payload.sourceBlockers).toEqual([]);
    expect(result.sessionStartText).toContain("llmdoc");

    const stop = await runKnowledgeHook({ cwd: fixture.source, event: "stop", registryDir: fixture.registryDir });
    expect(stop.payload.continue).toBe(true);

    expect(snapshotWorktree(fixture.source)).toEqual(sourceBefore);
    expect(sourceIndexBytes(fixture.source)).toEqual(indexBefore);
    expect(snapshotWorktree(fixture.knowledgeRoot)).toEqual(knowledgeBefore);
    expect(head(fixture.source)).toBe(fixture.sourceHead);
  });

  it("emits a diagnostic and never initializes when there is no binding", async () => {
    const dir = track(makeTempDir("llmdoc-hook-unbound-"));
    git(dir, ["init"]);
    git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test User"]);
    fs.writeFileSync(`${dir}/a.ts`, "export const a = 1;\n");
    git(dir, ["add", "a.ts"]);
    git(dir, ["commit", "-m", "init"]);

    const before = snapshotWorktree(dir);
    const result = await runKnowledgeHook({ cwd: dir, event: "stop", registryDir: track(makeTempDir("llmdoc-hook-registry-")) });
    expect(result.payload.mode).toBe("diagnostic");
    expect(result.payload.diagnostic).toContain("E_BINDING_NOT_FOUND");
    expect(result.payload.continue).toBe(true);
    expect(result.sessionStartText).toContain("no usable knowledge binding");
    expect(snapshotWorktree(dir)).toEqual(before);
  });

  it("keeps the compact message and rejects an unknown event", async () => {
    const dir = track(makeTempDir("llmdoc-hook-compact-"));
    const result = await runKnowledgeHook({ cwd: dir, event: "compact", registryDir: track(makeTempDir("llmdoc-hook-registry-")) });
    expect(result.payload.systemMessage).toContain("LLMDOC_STATE");
    expect(result.payload.continue).toBe(true);

    await expect(runHook({ cwd: dir, event: "explode", registryDir: dir })).rejects.toBeInstanceOf(KnowledgeError);
  });

  it("renders plain text for session-start and JSON for stop/compact through the CLI", async () => {
    const unbound = track(makeTempDir("llmdoc-hook-cli-"));
    const registryParent = track(makeTempDir("llmdoc-hook-cli-registry-"));
    const withRegistry = async <T>(run: () => Promise<T>): Promise<T> => {
      const key = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
      const previous = process.env[key];
      process.env[key] = registryParent;
      try {
        return await run();
      } finally {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    };

    const session = await withRegistry(() => runCli(["hook", "session-start"], unbound));
    expect(session.exitCode).toBe(0);
    expect(session.stdout).toContain("no usable knowledge binding");

    const stop = await withRegistry(() => runCli(["hook", "stop"], unbound));
    expect(stop.exitCode).toBe(0);
    const parsed = JSON.parse(stop.stdout) as { continue: boolean; systemMessage: string };
    expect(parsed.continue).toBe(true);

    const json = await withRegistry(() => runCli(["--json", "hook", "compact"], unbound));
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ schema: "llmdoc.hook/v1", event: "compact", mode: "diagnostic" });
  });
});
