import fs from "node:fs";
import path from "node:path";

import { KnowledgeError } from "./errors.js";
import { normalizeKnowledgeContent } from "./document.js";
import { addBlobToIndex, hashBlob } from "./git-write.js";
import {
  buildCandidateContent,
  generateCandidateId,
  inboxRepoPath,
  isInboxCandidateId,
  listCommittedInboxIds,
  listWorktreeInboxIds,
  type InboxCandidate
} from "./inbox.js";
import { withKnowledgeLock } from "./lock.js";
import { resolveWriteBinding } from "./binding.js";
import { resolveKnowledgeWriteContext, type KnowledgeWriteContext } from "./write-context.js";
import { publishKnowledgeCommit, type GeneratedFilePlan, type TransactionHooks } from "./transaction.js";

export interface CaptureOptions {
  sourceInput: string;
  knowledgeInput?: string;
  nested?: boolean;
  registryDir?: string;
  title?: string;
  note?: string;
  body?: string;
  fromFile?: string;
  sourceRevision?: string | null;
  now?: Date;
  testHooks?: TransactionHooks;
}

export interface CaptureResult {
  schema: "llmdoc.capture/v1";
  status: "captured";
  candidateId: string;
  repositoryId: string;
  sourceRevision: string | null;
  knowledgeBaseRevision: string;
  knowledgeRevision: string;
  branch: string;
  cleanupRequired: boolean;
  sync: { index: "synced" | "failed" | "skipped"; files: Array<{ path: string; synced: boolean }>; errors: string[] };
}

export const CAPTURE_COMMIT_PREFIX = "llmdoc: capture candidate";

/**
 * Capture is the same knowledge transaction as seal with a deliberately different write
 * set and validation semantics: it commits only `inbox/<candidate>` under the knowledge
 * lock, temp index, CAS and conditional sync, carries no verification trailer, and never
 * touches docs, meta, README or the source repository. It does not require a clean source
 * snapshot, but it still requires an explicit binding, an independent knowledge Git, a
 * branch with no in-progress operation and a knowledge index with no staged content.
 */
export async function captureCandidate(options: CaptureOptions): Promise<CaptureResult> {
  const binding = await resolveWriteBinding({
    sourceInput: options.sourceInput,
    knowledgeInput: options.knowledgeInput,
    nested: options.nested,
    registryDir: options.registryDir
  });
  return withKnowledgeLock(binding.knowledge.commonDir, async () => {
    const context = await resolveKnowledgeWriteContext({
      sourceInput: options.sourceInput,
      knowledgeInput: options.knowledgeInput,
      nested: options.nested,
      registryDir: options.registryDir
    });
    return captureLocked(context, options);
  });
}

async function captureLocked(context: KnowledgeWriteContext, options: CaptureOptions): Promise<CaptureResult> {
  await assertCapturePreconditions(context);
  const body = readBody(options);
  const normalizedBody = normalizeKnowledgeContent(body);
  const candidateId = await allocateCandidateId(context, options.title ?? null, options.now);
  const sourceRevision = options.sourceRevision ?? context.source.headRevision;
  const content = normalizeKnowledgeContent(
    buildCandidateContent({
      title: options.title,
      note: options.note,
      sourceRevision: sourceRevision ?? null,
      body: normalizedBody,
      now: options.now
    })
  );
  const candidatePath = path.join(context.knowledge.worktreeRoot, "inbox", candidateId);
  const repoPath = inboxRepoPath(candidateId);

  const buildIndex = async (tempIndex: string): Promise<void> => {
    const blob = await hashBlob(context.knowledgeGit, content);
    await addBlobToIndex(context.knowledgeGit, tempIndex, repoPath, blob);
  };

  const generatedFiles: GeneratedFilePlan[] = [
    { repoPath, absolutePath: candidatePath, observation: null, next: content }
  ];

  const result = await publishKnowledgeCommit({
    context,
    commitMessage: `${CAPTURE_COMMIT_PREFIX} ${candidateId}`,
    preLockCheck: async (ctx) => {
      await assertCapturePreconditions(ctx);
    },
    verifyFresh: async (fresh) => {
      await assertCapturePreconditions(fresh);
      if (fresh.knowledgeHead !== context.knowledgeHead || fresh.knowledgeBranch !== context.knowledgeBranch) {
        throw new KnowledgeError("E_KNOWLEDGE_HEAD_MISMATCH", "The knowledge HEAD or branch changed before the candidate was published", {
          exitCode: 3,
          paths: [fresh.knowledgeHead ?? "null", context.knowledgeHead ?? "null"]
        });
      }
      if (fresh.entry.repositoryId !== context.entry.repositoryId) {
        throw new KnowledgeError("E_SOURCE_IDENTITY_MISMATCH", "The source/knowledge identity changed before the candidate was published", {
          paths: [fresh.entry.repositoryId, context.entry.repositoryId]
        });
      }
    },
    buildIndex,
    generatedFiles,
    testHooks: options.testHooks
  });

  return {
    schema: "llmdoc.capture/v1",
    status: "captured",
    candidateId,
    repositoryId: context.entry.repositoryId,
    sourceRevision: sourceRevision ?? null,
    knowledgeBaseRevision: context.knowledgeHead!,
    knowledgeRevision: result.knowledgeRevision,
    branch: result.branch,
    cleanupRequired: result.cleanupRequired,
    sync: result.sync
  };
}

function readBody(options: CaptureOptions): string {
  if (options.body !== undefined && options.fromFile !== undefined) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", "capture accepts either --body or --from, not both", { exitCode: 2 });
  }
  if (options.fromFile !== undefined) {
    try {
      return fs.readFileSync(options.fromFile, "utf8");
    } catch (error) {
      throw new KnowledgeError("E_FILESYSTEM_IO", `Failed to read the capture source file: ${(error as Error).message}`, {
        exitCode: 70,
        paths: [options.fromFile]
      });
    }
  }
  if (options.body !== undefined) {
    return options.body;
  }
  throw new KnowledgeError("E_DOCUMENT_INVALID", "capture requires candidate content via --body or --from", {
    exitCode: 2,
    remediation: "Pass --from <file> or --body \"<markdown>\"."
  });
}

async function allocateCandidateId(context: KnowledgeWriteContext, title: string | null, now: Date | undefined): Promise<string> {
  const committed = new Set(await listCommittedInboxIds(context));
  const worktree = new Set(listWorktreeInboxIds(context.knowledge.worktreeRoot));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = generateCandidateId(title, now);
    if (!committed.has(id) && !worktree.has(id) && isInboxCandidateId(id)) {
      return id;
    }
  }
  throw new KnowledgeError("E_KNOWLEDGE_WRITE_FAILED", "Failed to allocate a unique inbox candidate id", { exitCode: 70 });
}

/**
 * Capture preconditions: no source clean requirement, no semantic manifest, but a real
 * knowledge branch, no in-progress Git operation and no staged content anywhere.
 */
export async function assertCapturePreconditions(context: KnowledgeWriteContext): Promise<void> {
  const { knowledgeHead, knowledgeHeadState, knowledgeOperation, knowledgeClean } = context;
  if (knowledgeHead === null || knowledgeHeadState.unborn || knowledgeHeadState.detached) {
    throw new KnowledgeError("E_KNOWLEDGE_NOT_ON_BRANCH", "Capture requires the knowledge repository to have an initial commit on a branch", {
      exitCode: 3,
      paths: [context.knowledge.worktreeRoot],
      remediation: "Create an initial knowledge commit and check out a branch before capturing."
    });
  }
  if (knowledgeOperation !== null) {
    throw new KnowledgeError("E_KNOWLEDGE_NOT_ON_BRANCH", `Capture is blocked while a Git ${knowledgeOperation} is in progress`, {
      exitCode: 3,
      paths: [context.knowledge.worktreeRoot]
    });
  }
  if (!knowledgeClean.available || knowledgeClean.stagedPaths.length > 0) {
    throw new KnowledgeError("E_KNOWLEDGE_INDEX_DIRTY", "The knowledge index has staged content; capture never unstages or overwrites it", {
      exitCode: 3,
      paths: [...knowledgeClean.stagedPaths],
      remediation: "Commit, unstage or discard the staged knowledge changes; llmdoc does not modify the index on your behalf."
    });
  }
}

export type { InboxCandidate };
