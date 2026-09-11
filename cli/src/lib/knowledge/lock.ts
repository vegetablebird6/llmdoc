import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KnowledgeError } from "./errors.js";

export const KNOWLEDGE_LOCK_FILENAME = "llmdoc.lock";

export interface KnowledgeLockOwner {
  ownerToken: string;
  pid: number;
  host: string;
  bootId: string | null;
  processStartTimeMs: number | null;
  acquiredAt: string;
}

export interface KnowledgeLockHandle {
  lockPath: string;
  owner: KnowledgeLockOwner;
  release: () => void;
}

export interface AcquireKnowledgeLockOptions {
  timeoutMs?: number;
  pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 50;

/**
 * A cache of this process's approximate boot identity. Two calls in the same boot must
 * return the same value; a reboot changes it. Approximate minute resolution avoids
 * jitter between calls.
 */
let cachedBootId: string | null | undefined;

export function currentBootId(): string | null {
  if (cachedBootId !== undefined) {
    return cachedBootId;
  }
  cachedBootId = resolveBootId();
  return cachedBootId;
}

function resolveBootId(): string | null {
  try {
    if (process.platform === "linux") {
      const raw = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      if (raw.length > 0) {
        return raw;
      }
    }
  } catch {
    // fall through to the uptime-derived approximation
  }
  try {
    const bootEpochMinutes = Math.floor((Date.now() / 1000 - os.uptime()) / 60);
    return `uptime-boot-${bootEpochMinutes}`;
  } catch {
    return null;
  }
}

export function currentProcessStartTimeMs(): number | null {
  try {
    return Math.round(Date.now() - process.uptime() * 1000);
  } catch {
    return null;
  }
}

export async function acquireKnowledgeLock(
  commonDir: string,
  options: AcquireKnowledgeLockOptions = {}
): Promise<KnowledgeLockHandle> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const lockPath = path.join(commonDir, KNOWLEDGE_LOCK_FILENAME);
  const owner: KnowledgeLockOwner = {
    ownerToken: `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    pid: process.pid,
    host: os.hostname(),
    bootId: currentBootId(),
    processStartTimeMs: currentProcessStartTimeMs(),
    acquiredAt: new Date().toISOString()
  };
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (tryCreateLock(lockPath, owner)) {
      return { lockPath, owner, release: () => releaseLock(lockPath, owner.ownerToken) };
    }
    const observed = readLockOwner(lockPath);
    if (observed !== null && isRecoverable(observed)) {
      if (removeIfUnchanged(lockPath, observed.ownerToken)) {
        continue;
      }
    }
    if (Date.now() >= deadline) {
      throw unavailableError(lockPath, observed);
    }
    await sleep(pollMs);
  }
}

export async function withKnowledgeLock<T>(
  commonDir: string,
  operation: () => T | Promise<T>,
  options: AcquireKnowledgeLockOptions = {}
): Promise<T> {
  const lock = await acquireKnowledgeLock(commonDir, options);
  try {
    return await operation();
  } finally {
    lock.release();
  }
}

function tryCreateLock(lockPath: string, owner: KnowledgeLockOwner): boolean {
  let handle: number;
  try {
    handle = fs.openSync(lockPath, "wx");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return false;
    }
    throw new KnowledgeError("E_KNOWLEDGE_WRITE_FAILED", `Failed to create the knowledge lock: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [lockPath]
    });
  }
  try {
    fs.writeFileSync(handle, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(handle);
  }
  return true;
}

function readLockOwner(lockPath: string): KnowledgeLockOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<KnowledgeLockOwner>;
    if (typeof parsed.ownerToken !== "string" || typeof parsed.pid !== "number") {
      return null;
    }
    return {
      ownerToken: parsed.ownerToken,
      pid: parsed.pid,
      host: typeof parsed.host === "string" ? parsed.host : "",
      bootId: typeof parsed.bootId === "string" ? parsed.bootId : null,
      processStartTimeMs: typeof parsed.processStartTimeMs === "number" ? parsed.processStartTimeMs : null,
      acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : ""
    };
  } catch {
    return null;
  }
}

/**
 * Recovery is deliberately conservative: a lock is only removed when the holder can be
 * proven gone. Reboot (different boot id), a dead pid, or a pid whose live process start
 * time no longer matches are proofs. Anything else — including a platform where process
 * identity cannot be read — keeps the lock and reports the holder for manual handling.
 */
function isRecoverable(owner: KnowledgeLockOwner): boolean {
  // Only the exact same host can ever be proven; an empty or foreign host is never ours.
  if (owner.host !== os.hostname()) {
    return false;
  }
  const bootId = currentBootId();
  if (bootId === null || owner.bootId === null) {
    // Without a comparable boot identity we cannot distinguish a reboot from a live holder.
    return false;
  }
  if (owner.bootId !== bootId) {
    // A different boot on the same host proves the recorded holder cannot still be running.
    return true;
  }
  if (owner.processStartTimeMs === null) {
    // Identity is incomplete: conservative manual handling, never delete automatically.
    return false;
  }
  if (!isProcessAlive(owner.pid)) {
    return true;
  }
  const liveStart = readProcessStartTimeMs(owner.pid);
  if (liveStart !== null && Math.abs(liveStart - owner.processStartTimeMs) > 2000) {
    return true;
  }
  return false;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Best-effort live process start time; null when the platform cannot provide it. */
export function readProcessStartTimeMs(pid: number): number | null {
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).split(" ");
      // After the comm field, field 22 (starttime) is at index 19 in the remainder.
      const startTicks = Number(fields[19]);
      if (!Number.isFinite(startTicks)) {
        return null;
      }
      const hertz = 100;
      const bootEpochMs = (Date.now() / 1000 - os.uptime()) * 1000;
      return Math.round(bootEpochMs + (startTicks / hertz) * 1000);
    }
  } catch {
    return null;
  }
  return null;
}

function removeIfUnchanged(lockPath: string, ownerToken: string): boolean {
  try {
    const current = readLockOwner(lockPath);
    if (current === null || current.ownerToken !== ownerToken) {
      return false;
    }
    fs.rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function releaseLock(lockPath: string, ownerToken: string): void {
  try {
    const current = readLockOwner(lockPath);
    if (current !== null && current.ownerToken === ownerToken) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch {
    // never delete a lock we cannot confirm as ours
  }
}

function unavailableError(lockPath: string, observed: KnowledgeLockOwner | null): KnowledgeError {
  const holder =
    observed === null
      ? "an unreadable lock file"
      : `pid ${observed.pid} on ${observed.host || "unknown host"} since ${observed.acquiredAt || "unknown time"}`;
  return new KnowledgeError("E_KNOWLEDGE_LOCKED", "The knowledge repository is locked by another writer", {
    exitCode: 70,
    paths: [lockPath],
    remediation: `Retry once the holder finishes. Holder: ${holder}. llmdoc never deletes a lock unless it can prove the holder exited.`
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
