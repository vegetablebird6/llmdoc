import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  KNOWLEDGE_LOCK_FILENAME,
  acquireKnowledgeLock,
  currentBootId,
  currentProcessStartTimeMs
} from "../src/lib/knowledge/lock.js";
import { expectKnowledgeError, makeTempDir } from "./knowledge-helpers.js";

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

function makeCommonDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  createdDirs.push(dir);
  return dir;
}

function writeLock(commonDir: string, owner: Record<string, unknown>): string {
  const lockPath = path.join(commonDir, KNOWLEDGE_LOCK_FILENAME);
  fs.writeFileSync(lockPath, `${JSON.stringify(owner, null, 2)}\n`);
  return lockPath;
}

describe("knowledge write lock", () => {
  it("serializes two writers and reports the holder", async () => {
    const commonDir = makeCommonDir("llmdoc-lock-mutex-");
    const first = await acquireKnowledgeLock(commonDir, { timeoutMs: 1000 });
    await expectKnowledgeError(() => acquireKnowledgeLock(commonDir, { timeoutMs: 200, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);
    first.release();
    const second = await acquireKnowledgeLock(commonDir, { timeoutMs: 1000 });
    second.release();
    expect(fs.existsSync(path.join(commonDir, KNOWLEDGE_LOCK_FILENAME))).toBe(false);
  });

  it("does not wrongly recover an active lock held by the current process", async () => {
    const commonDir = makeCommonDir("llmdoc-lock-active-");
    const lock = await acquireKnowledgeLock(commonDir, { timeoutMs: 1000 });
    await expectKnowledgeError(() => acquireKnowledgeLock(commonDir, { timeoutMs: 150, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);
    expect(fs.existsSync(lock.lockPath)).toBe(true);
    lock.release();
  });

  it("recovers a lock whose recorded process is dead on the same boot", async () => {
    const commonDir = makeCommonDir("llmdoc-lock-dead-");
    writeLock(commonDir, {
      ownerToken: "dead-owner",
      pid: 999999,
      host: os.hostname(),
      bootId: currentBootId(),
      processStartTimeMs: Date.now() - 10_000,
      acquiredAt: new Date().toISOString()
    });
    const lock = await acquireKnowledgeLock(commonDir, { timeoutMs: 1000 });
    lock.release();
  });

  it("recovers a lock from a previous boot even when the pid is now in use", async () => {
    const commonDir = makeCommonDir("llmdoc-lock-reboot-");
    writeLock(commonDir, {
      ownerToken: "old-boot",
      pid: process.pid,
      host: os.hostname(),
      bootId: `${currentBootId() ?? "boot"}-previous`,
      processStartTimeMs: currentProcessStartTimeMs(),
      acquiredAt: new Date().toISOString()
    });
    const lock = await acquireKnowledgeLock(commonDir, { timeoutMs: 1000 });
    lock.release();
  });

  it("keeps an unreadable or identity-less lock instead of deleting it", async () => {
    const commonDir = makeCommonDir("llmdoc-lock-conservative-");
    fs.writeFileSync(path.join(commonDir, KNOWLEDGE_LOCK_FILENAME), "not-json");
    await expectKnowledgeError(() => acquireKnowledgeLock(commonDir, { timeoutMs: 150, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);

    // Pid alive but no process start time to disprove reuse: never recover.
    writeLock(commonDir, {
      ownerToken: "no-identity",
      pid: process.pid,
      host: os.hostname(),
      bootId: currentBootId(),
      processStartTimeMs: null,
      acquiredAt: new Date().toISOString()
    });
    await expectKnowledgeError(() => acquireKnowledgeLock(commonDir, { timeoutMs: 150, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);
  });

  it("does not recover a lock with a missing or foreign host even when the pid is dead", async () => {
    const missingHost = makeCommonDir("llmdoc-lock-nohost-");
    writeLock(missingHost, {
      ownerToken: "no-host",
      pid: 999999,
      host: "",
      bootId: currentBootId(),
      processStartTimeMs: Date.now() - 10_000,
      acquiredAt: new Date().toISOString()
    });
    await expectKnowledgeError(() => acquireKnowledgeLock(missingHost, { timeoutMs: 150, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);

    const foreignHost = makeCommonDir("llmdoc-lock-foreignhost-");
    writeLock(foreignHost, {
      ownerToken: "foreign-host",
      pid: 999999,
      host: "some-other-machine",
      bootId: currentBootId(),
      processStartTimeMs: Date.now() - 10_000,
      acquiredAt: new Date().toISOString()
    });
    await expectKnowledgeError(() => acquireKnowledgeLock(foreignHost, { timeoutMs: 150, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);
  });

  it("does not recover a lock that is missing its boot or process identity", async () => {
    const noBoot = makeCommonDir("llmdoc-lock-noboot-");
    writeLock(noBoot, {
      ownerToken: "no-boot",
      pid: 999999,
      host: os.hostname(),
      bootId: null,
      processStartTimeMs: Date.now() - 10_000,
      acquiredAt: new Date().toISOString()
    });
    await expectKnowledgeError(() => acquireKnowledgeLock(noBoot, { timeoutMs: 150, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);

    const noStart = makeCommonDir("llmdoc-lock-nostart-");
    writeLock(noStart, {
      ownerToken: "no-start",
      pid: 999999,
      host: os.hostname(),
      bootId: currentBootId(),
      processStartTimeMs: null,
      acquiredAt: new Date().toISOString()
    });
    await expectKnowledgeError(() => acquireKnowledgeLock(noStart, { timeoutMs: 150, pollMs: 20 }), "E_KNOWLEDGE_LOCKED", 70);
  });
});
