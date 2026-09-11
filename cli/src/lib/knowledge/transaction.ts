import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KnowledgeError } from "./errors.js";
import {
  acquireIndexLock,
  commitTree,
  publishIndex,
  readTreeIntoIndex,
  updateRefCas,
  writeTreeFromIndex
} from "./git-write.js";
import { reloadKnowledgeWriteContext, type KnowledgeWriteContext } from "./write-context.js";

/**
 * Shared knowledge-commit transaction. Every knowledge write that advances a committed
 * tree (seal, capture) uses this single lane: build the new tree in a private temporary
 * index, create the commit, re-verify against a fresh reload while holding the real
 * index lock, publish with a compare-and-swap ref update, then atomically sync the real
 * index and any llmdoc-generated files. Failure after the ref moves is always reported as
 * an already-published commit plus `cleanup_required`; the transaction never resets.
 */

export const KNOWLEDGE_COMMIT_IDENTITY = {
  GIT_AUTHOR_NAME: "llmdoc",
  GIT_AUTHOR_EMAIL: "llmdoc@llmdoc.local",
  GIT_COMMITTER_NAME: "llmdoc",
  GIT_COMMITTER_EMAIL: "llmdoc@llmdoc.local"
};

export interface TransactionHooks {
  /** Injected race seam after the index observation but before index.lock. */
  beforeIndexLock?: () => void | Promise<void>;
  /** Injected failure seam just before the final pre-CAS verification. */
  beforePublish?: () => void | Promise<void>;
  /** Injected race seam between the final verification and the CAS. */
  beforeCas?: () => void | Promise<void>;
  /** Injected post-publish failure seam; used to exercise cleanup_required. */
  afterPublish?: () => void | Promise<void>;
}

export interface GeneratedFilePlan {
  /** Repository-relative path used in the sync report. */
  repoPath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** Byte observation taken before publication; null means the file was absent. */
  observation: Buffer | null;
  /** Desired content. When undefined the file is observed but never written (capture). */
  next?: string | Buffer;
  /** When true the file is conditionally deleted (candidate removal) instead of written. */
  remove?: boolean;
}

export interface ConditionalWriteHooks {
  /** Injected race seam between the observation compare and the replacement. */
  afterCompare?: () => void;
  /** Injected failure seam after the temp file is written but before the atomic rename. */
  beforeRename?: () => void;
}

export interface PublishKnowledgeCommitOptions {
  context: KnowledgeWriteContext;
  /** Populates the temporary index (already read-tree'd from K0). */
  buildIndex: (tempIndex: string) => Promise<void>;
  commitMessage: string;
  /** Cheap re-check performed before acquiring the real index lock. */
  preLockCheck?: (context: KnowledgeWriteContext) => void | Promise<void>;
  /** Full re-verification against the fresh reload while holding the index lock. */
  verifyFresh: (fresh: KnowledgeWriteContext) => void | Promise<void>;
  /** Files to conditionally sync after publication. */
  generatedFiles: GeneratedFilePlan[];
  /** Extra post-publication work (e.g. mark a manifest consumed); return sync errors. */
  afterPublish?: (knowledgeRevision: string) => string[] | void;
  testHooks?: TransactionHooks;
}

export interface TransactionSyncResult {
  index: "synced" | "failed" | "skipped";
  files: Array<{ path: string; synced: boolean }>;
  errors: string[];
}

export interface PublishKnowledgeCommitResult {
  knowledgeRevision: string;
  branch: string;
  sync: TransactionSyncResult;
  cleanupRequired: boolean;
}

export async function publishKnowledgeCommit(
  options: PublishKnowledgeCommitOptions
): Promise<PublishKnowledgeCommitResult> {
  const { context, testHooks } = options;
  const branch = context.knowledgeBranch;
  const knowledgeBaseRevision = context.knowledgeHead;
  if (branch === null || knowledgeBaseRevision === null) {
    throw new KnowledgeError("E_KNOWLEDGE_NOT_ON_BRANCH", "A knowledge commit requires a branch with an initial commit", {
      exitCode: 3,
      paths: [context.knowledge.worktreeRoot]
    });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdoc-txn-"));
  const tempIndex = path.join(tempDir, "index");
  const indexPath = path.join(context.knowledgeGit.gitDir, "index");
  let knowledgeRevision: string;
  try {
    await readTreeIntoIndex(context.knowledgeGit, tempIndex, knowledgeBaseRevision);
    await options.buildIndex(tempIndex);
    const tree = await writeTreeFromIndex(context.knowledgeGit, tempIndex);
    knowledgeRevision = await commitTree(
      context.knowledgeGit,
      tree,
      [knowledgeBaseRevision],
      options.commitMessage,
      KNOWLEDGE_COMMIT_IDENTITY
    );
  } catch (error) {
    removeDirectory(tempDir);
    throw error;
  }

  try {
    if (options.preLockCheck) {
      await options.preLockCheck(context);
    }
    const indexObservation = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;
    if (testHooks?.beforeIndexLock) {
      await testHooks.beforeIndexLock();
    }
    const indexLock = acquireIndexLock(context.knowledgeGit);
    let lockConsumed = false;
    try {
      if (!indexStillMatches(indexPath, indexObservation)) {
        throw new KnowledgeError("E_KNOWLEDGE_INDEX_DIRTY", "The knowledge index changed between review and publication", {
          exitCode: 3,
          paths: [indexPath],
          remediation: "Another Git writer touched the index; re-run the operation."
        });
      }
      if (testHooks?.beforePublish) {
        await testHooks.beforePublish();
      }
      const fresh = await reloadKnowledgeWriteContext(context);
      await options.verifyFresh(fresh);
      if (testHooks?.beforeCas) {
        await testHooks.beforeCas();
      }
      const updated = await updateRefCas(
        context.knowledgeGit,
        `refs/heads/${branch}`,
        knowledgeRevision,
        knowledgeBaseRevision
      );
      if (!updated) {
        throw new KnowledgeError("E_CAS_CONFLICT", "The knowledge branch moved before publication; the commit was not applied", {
          exitCode: 70,
          paths: [`refs/heads/${branch}`],
          remediation: "Re-run the operation against the new knowledge HEAD; llmdoc never resets the branch."
        });
      }

      const sync: TransactionSyncResult = { index: "skipped", files: [], errors: [] };
      let cleanupRequired = false;

      // From here on the commit is published: failures must be reported, never rolled back.
      try {
        publishIndex(indexLock, tempIndex);
        lockConsumed = true;
        sync.index = "synced";
      } catch (error) {
        cleanupRequired = true;
        sync.index = "failed";
        sync.errors.push((error as Error).message);
      }

      if (testHooks?.afterPublish) {
        try {
          await testHooks.afterPublish();
        } catch (error) {
          cleanupRequired = true;
          sync.errors.push((error as Error).message);
        }
      }

      for (const file of options.generatedFiles) {
        if (file.remove === true) {
          const removed = conditionalDelete(file.absolutePath, file.observation);
          sync.files.push({ path: file.repoPath, synced: removed });
          if (!removed) {
            cleanupRequired = true;
            sync.errors.push(`Unsynced knowledge deletion: ${file.repoPath}`);
          }
          continue;
        }
        if (file.next === undefined) {
          continue;
        }
        const synced = conditionalWrite(file.absolutePath, file.observation, file.next);
        sync.files.push({ path: file.repoPath, synced });
        if (!synced) {
          cleanupRequired = true;
          sync.errors.push(`Unsynced knowledge file: ${file.repoPath}`);
        }
      }

      if (options.afterPublish) {
        try {
          const errors = options.afterPublish(knowledgeRevision);
          if (errors && errors.length > 0) {
            cleanupRequired = true;
            sync.errors.push(...errors);
          }
        } catch (error) {
          cleanupRequired = true;
          sync.errors.push((error as Error).message);
        }
      }

      return { knowledgeRevision, branch, sync, cleanupRequired };
    } finally {
      if (!lockConsumed) {
        indexLock.release();
      }
    }
  } finally {
    removeDirectory(tempDir);
  }
}

/**
 * Conditionally writes a generated file. When the observation was "absent" the file is
 * created atomically with `wx`, so a concurrently created file is never overwritten.
 * When replacing an existing file, a short-lived exclusive sidecar lock plus a re-read
 * under that lock form a verifiable compare-and-swap for cooperating writers; any
 * mismatch fails conservatively instead of clobbering another writer's bytes.
 */
export function conditionalWrite(
  filePath: string,
  observation: Buffer | null,
  next: string | Buffer,
  hooks?: ConditionalWriteHooks
): boolean {
  if (observation === null) {
    try {
      fs.writeFileSync(filePath, next, { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
  const lockPath = `${filePath}.llmdoc-sync.lock`;
  let lockFd: number;
  try {
    lockFd = fs.openSync(lockPath, "wx");
  } catch {
    return false;
  }
  let tempPath: string | null = null;
  try {
    const current = readIfExists(filePath);
    if (current === null || !current.equals(observation)) {
      return false;
    }
    hooks?.afterCompare?.();
    const recheck = readIfExists(filePath);
    if (recheck === null || !recheck.equals(observation)) {
      return false;
    }
    tempPath = `${filePath}.llmdoc-sync-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    fs.writeFileSync(tempPath, next);
    hooks?.beforeRename?.();
    fs.renameSync(tempPath, filePath);
    tempPath = null;
    return true;
  } catch {
    return false;
  } finally {
    // Only this call's temp and sidecar lock are cleaned; a rename failure must not leave
    // a stray `.llmdoc-sync-*` file behind.
    if (tempPath !== null) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // best-effort temp cleanup
      }
    }
    try {
      fs.closeSync(lockFd);
    } catch {
      // best-effort release
    }
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // best-effort release
    }
  }
}

/**
 * Conditionally deletes a candidate that was observed as absent. Only `observation === null`
 * is supported: success requires the path to still be absent. A path that (re)appeared is
 * preserved and reported unsynced rather than removed, because a read→rm CAS cannot lock
 * arbitrary external editors (frozen architecture §6 cooperating-writer boundary).
 */
export function conditionalDelete(filePath: string, observation: Buffer | null): boolean {
  if (observation !== null) {
    return false;
  }
  return readIfExists(filePath) === null;
}

function readIfExists(filePath: string): Buffer | null {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  } catch {
    return null;
  }
}

export function indexStillMatches(indexPath: string, observation: Buffer | null): boolean {
  try {
    const current = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;
    if (observation === null) {
      return current === null;
    }
    return current !== null && observation.equals(current);
  } catch {
    return false;
  }
}

export function readIndexObservation(indexPath: string): Buffer | null {
  try {
    return fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;
  } catch {
    return null;
  }
}

function removeDirectory(directory: string): void {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // temp cleanup is best-effort
  }
}
