import fs from "node:fs";
import path from "node:path";

import { KnowledgeError } from "./errors.js";
import { normalizeKnowledgeContent } from "./document.js";
import { readGitBlobs, runGit } from "./git-core.js";
import {
  addBlobToIndex,
  acquireIndexLock,
  commitTree,
  hashBlob,
  publishIndex,
  readTreeIntoIndex,
  removeIndexPath,
  updateRefCas,
  writeTreeFromIndex
} from "./git-write.js";
import { withKnowledgeLock } from "./lock.js";
import type { KnowledgeMeta, ValidatedEvidence } from "./meta.js";
import {
  attachCandidateRequires,
  buildReviewItems,
  deriveWriteSet,
  loadReviewManifest,
  markReviewConsumed,
  sameList,
  writeReviewManifest,
  type ReviewConclusion,
  type ReviewDocumentItem,
  type ReviewManifest
} from "./review.js";
import { resolveWriteBinding } from "./binding.js";
import {
  assertReviewPreconditions,
  reloadKnowledgeWriteContext,
  resolveKnowledgeWriteContext,
  type KnowledgeWriteContext
} from "./write-context.js";

const SEAL_IDENTITY = {
  GIT_AUTHOR_NAME: "llmdoc",
  GIT_AUTHOR_EMAIL: "llmdoc@llmdoc.local",
  GIT_COMMITTER_NAME: "llmdoc",
  GIT_COMMITTER_EMAIL: "llmdoc@llmdoc.local"
};

const META_REPO_PATH = ".llmdoc/meta.json";

export interface SealTestHooks {
  /** Injected race seam after the initial clean-index check but before index.lock. */
  beforeIndexLock?: () => void | Promise<void>;
  /** Injected failure seam just before the final pre-CAS verification. */
  beforePublish?: () => void | Promise<void>;
  /** Injected race seam between the final verification and the CAS. */
  beforeCas?: () => void | Promise<void>;
  /** Injected post-publish failure seam; used to exercise cleanup_required. */
  afterPublish?: () => void | Promise<void>;
}

export interface SealReviewOptions {
  sourceInput: string;
  knowledgeInput?: string;
  nested?: boolean;
  registryDir?: string;
  reviewId: string;
  testHooks?: SealTestHooks;
}

export interface SealSyncResult {
  index: "synced" | "failed" | "skipped";
  files: Array<{ path: string; synced: boolean }>;
  errors: string[];
}

export interface SealResult {
  schema: "llmdoc.commit/v1";
  status: "success" | "no_change";
  reviewId: string;
  repositoryId: string;
  sourceRevision: string;
  knowledgeBaseRevision: string;
  knowledgeRevision: string | null;
  branch: string | null;
  metaOnly: boolean;
  changedDocuments: string[];
  refreshedDocuments: string[];
  deletedDocuments: string[];
  lastGlobalReviewRevision: string | null;
  cleanupRequired: boolean;
  sync: SealSyncResult;
}

export async function sealKnowledgeReview(options: SealReviewOptions): Promise<SealResult> {
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
    return sealLocked(context, options);
  });
}

async function sealLocked(context: KnowledgeWriteContext, options: SealReviewOptions): Promise<SealResult> {
  await assertReviewPreconditions(context);
  const manifest = loadReviewManifest(context.knowledge.worktreeRoot, options.reviewId);
  assertManifestBinding(context, manifest);
  if (manifest.consumed) {
    throw invalidated("This review manifest has already been consumed", [options.reviewId]);
  }
  if (!manifest.confirmed) {
    throw new KnowledgeError("E_REVIEW_NOT_CONFIRMED", "The review manifest has not been confirmed by a human or Agent", {
      exitCode: 3,
      paths: [options.reviewId],
      remediation: "Inspect the manifest and run `llmdoc review --confirm <reviewId>` to declare the semantic conclusions."
    });
  }
  const sourceRevision = context.source.headRevision;
  const knowledgeBaseRevision = context.knowledgeHead;
  if (sourceRevision === null || knowledgeBaseRevision === null) {
    throw invalidated("The fixed source/knowledge revisions are unavailable", []);
  }
  if (manifest.sourceRevision !== sourceRevision) {
    throw new KnowledgeError("E_SOURCE_HEAD_DRIFT", "The source HEAD advanced or changed after the review manifest was generated", {
      exitCode: 3,
      paths: [sourceRevision, manifest.sourceRevision],
      remediation: "Re-run `llmdoc review` against the new source revision."
    });
  }
  if (manifest.knowledgeBaseRevision !== knowledgeBaseRevision) {
    throw new KnowledgeError("E_KNOWLEDGE_HEAD_MISMATCH", "The knowledge HEAD no longer matches the manifest K0", {
      exitCode: 3,
      paths: [knowledgeBaseRevision, manifest.knowledgeBaseRevision],
      remediation: "Re-run `llmdoc review`; the knowledge branch moved since the manifest was generated."
    });
  }

  const conclusions = new Map(manifest.documents.map((item) => [item.id, (item.conclusion ?? "insufficient") as ReviewConclusion]));
  verifyManifestAgainstWorktree(context, manifest, conclusions);

  const k0MetaRaw = (await readGitBlobs(context.knowledgeGit, knowledgeBaseRevision, [META_REPO_PATH])).get(META_REPO_PATH) ?? null;
  const metaPath = context.knowledge.metaPath;
  const metaObservation = fs.existsSync(metaPath) ? fs.readFileSync(metaPath) : null;
  if (manifest.writeSet.meta) {
    if (metaObservation === null || k0MetaRaw === null || !metaObservation.equals(Buffer.from(k0MetaRaw, "utf8"))) {
      throw new KnowledgeError("E_KNOWLEDGE_META_DIRTY", "The knowledge meta ledger has uncommitted edits that are not part of this review", {
        exitCode: 3,
        paths: [metaPath],
        remediation: "Revert or commit the meta edits explicitly before sealing; llmdoc never overwrites an unobserved ledger."
      });
    }
  }

  const newMeta = buildNextMeta(context, manifest, conclusions, sourceRevision);
  const metaBytes = `${JSON.stringify(newMeta, null, 2)}\n`;

  if (!manifest.writeSet.meta) {
    return consumeNoChange(context, manifest, conclusions, sourceRevision, knowledgeBaseRevision, newMeta.source.lastGlobalReviewRevision, options.testHooks);
  }

  const cacheDir = path.join(context.knowledge.worktreeRoot, ".llmdoc-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const tempIndex = path.join(cacheDir, `seal-index-${manifest.reviewId}`);
  removeIfExists(tempIndex);
  const indexPath = path.join(context.knowledgeGit.gitDir, "index");
  const indexObservation = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;

  let knowledgeRevision: string;
  const lineEndingNormalizations: Array<{ id: string; raw: string; normalized: string }> = [];
  try {
    await readTreeIntoIndex(context.knowledgeGit, tempIndex, knowledgeBaseRevision);

    for (const item of manifest.documents) {
      const conclusion = conclusions.get(item.id);
      if (conclusion === "insufficient") {
        continue;
      }
      // Physical action, not the semantic label, decides the tree: add/update write the
      // candidate blob, delete removes the path, refresh is a no-op.
      if (item.action === "delete") {
        await removeIndexPath(context.knowledgeGit, tempIndex, `docs/${item.id}`);
      } else if (item.action === "add" || item.action === "update") {
        const entry = context.worktree.entries.find((candidate) => candidate.id === item.id);
        if (entry === undefined) {
          throw invalidated(`Reviewed document is missing from the knowledge worktree: ${item.id}`, [item.id]);
        }
        const normalized = normalizeKnowledgeContent(entry.raw);
        if (entry.raw !== normalized) {
          lineEndingNormalizations.push({ id: item.id, raw: entry.raw, normalized });
        }
        const blob = await hashBlob(context.knowledgeGit, normalized);
        await addBlobToIndex(context.knowledgeGit, tempIndex, `docs/${item.id}`, blob);
      }
    }

    const metaBlob = await hashBlob(context.knowledgeGit, metaBytes);
    await addBlobToIndex(context.knowledgeGit, tempIndex, META_REPO_PATH, metaBlob);
    const tree = await writeTreeFromIndex(context.knowledgeGit, tempIndex);
    const message = buildCommitMessage(context, manifest, sourceRevision);
    knowledgeRevision = await commitTree(context.knowledgeGit, tree, [knowledgeBaseRevision], message, SEAL_IDENTITY);
  } catch (error) {
    removeIfExists(tempIndex);
    throw error;
  }

  const sync: SealSyncResult = { index: "skipped", files: [], errors: [] };
  let cleanupRequired = false;

  // Pre-publish re-checks: source still S and clean, knowledge branch/HEAD unchanged.
  await reassertPublishPreconditions(context, sourceRevision, knowledgeBaseRevision);

  const indexLock = acquireIndexLock(context.knowledgeGit);
  let lockConsumed = false;
  try {
    if (!indexStillMatches(indexPath, indexObservation)) {
      throw new KnowledgeError("E_KNOWLEDGE_INDEX_DIRTY", "The knowledge index changed between review and publication", {
        exitCode: 3,
        paths: [indexPath],
        remediation: "Another Git writer touched the index; re-run `llmdoc review`."
      });
    }
    if (options.testHooks?.beforePublish) {
      await options.testHooks.beforePublish();
    }
    // Final pre-CAS verification while holding index.lock: re-read the source revision,
    // K0 and the worktree and re-check the complete manifest/write set. Any body, front
    // matter, scope, requires, deletion or unreviewed addition after the earlier check
    // aborts here, before the ref moves and before anything is published.
    const fresh = await reloadKnowledgeWriteContext(context);
    await assertReviewPreconditions(fresh);
    if (fresh.source.headRevision !== sourceRevision) {
      throw new KnowledgeError("E_SOURCE_HEAD_DRIFT", "The source HEAD changed before publication", {
        exitCode: 3,
        paths: [fresh.source.headRevision ?? "null", sourceRevision],
        remediation: "Re-run `llmdoc review` against the new source revision."
      });
    }
    if (fresh.knowledgeHead !== knowledgeBaseRevision || fresh.knowledgeBranch !== context.knowledgeBranch) {
      throw new KnowledgeError("E_KNOWLEDGE_HEAD_MISMATCH", "The knowledge HEAD or branch changed before publication", {
        exitCode: 3,
        paths: [fresh.knowledgeHead ?? "null", knowledgeBaseRevision],
        remediation: "Re-run `llmdoc review`; the knowledge branch moved since the manifest was generated."
      });
    }
    verifyManifestAgainstWorktree(fresh, manifest, conclusions);
    if (options.testHooks?.beforeCas) {
      await options.testHooks.beforeCas();
    }
    const updated = await updateRefCas(
      context.knowledgeGit,
      `refs/heads/${context.knowledgeBranch}`,
      knowledgeRevision,
      knowledgeBaseRevision
    );
    if (!updated) {
      throw new KnowledgeError("E_CAS_CONFLICT", "The knowledge branch moved before publication; the seal was not applied", {
        exitCode: 70,
        paths: [`refs/heads/${context.knowledgeBranch}`],
        remediation: "Re-run `llmdoc review` against the new knowledge HEAD; llmdoc never resets the branch."
      });
    }

    // From here on K1 is published: failures must be reported, never rolled back.
    try {
      publishIndex(indexLock, tempIndex);
      lockConsumed = true;
      sync.index = "synced";
    } catch (error) {
      cleanupRequired = true;
      sync.index = "failed";
      sync.errors.push((error as Error).message);
    }

    if (options.testHooks?.afterPublish) {
      try {
        await options.testHooks.afterPublish();
      } catch (error) {
        cleanupRequired = true;
        sync.errors.push((error as Error).message);
      }
    }

    if (manifest.writeSet.meta) {
      const synced = conditionalWrite(metaPath, metaObservation, metaBytes);
      sync.files.push({ path: META_REPO_PATH, synced });
      if (!synced) {
        cleanupRequired = true;
        sync.errors.push(`Unsynced knowledge file: ${META_REPO_PATH}`);
      }
    }

    for (const normalization of lineEndingNormalizations) {
      const docPath = path.join(context.knowledge.docsRoot, normalization.id);
      const ok = conditionalWrite(docPath, Buffer.from(normalization.raw, "utf8"), normalization.normalized);
      if (!ok) {
        cleanupRequired = true;
        sync.errors.push(`Unsynced knowledge file: docs/${normalization.id}`);
      }
    }

    try {
      writeReviewManifest(context.knowledge.worktreeRoot, markReviewConsumed(manifest, knowledgeRevision));
    } catch (error) {
      cleanupRequired = true;
      sync.errors.push(`Failed to mark the manifest consumed: ${(error as Error).message}`);
    }
  } finally {
    if (!lockConsumed) {
      indexLock.release();
    }
    removeIfExists(tempIndex);
  }

  const refreshedDocuments = manifest.writeSet.refresh;
  return {
    schema: "llmdoc.commit/v1",
    status: "success",
    reviewId: manifest.reviewId,
    repositoryId: context.entry.repositoryId,
    sourceRevision,
    knowledgeBaseRevision,
    knowledgeRevision,
    branch: context.knowledgeBranch,
    metaOnly: manifest.writeSet.documents.length === 0 && manifest.writeSet.deletions.length === 0,
    changedDocuments: manifest.writeSet.documents,
    refreshedDocuments,
    deletedDocuments: manifest.writeSet.deletions,
    lastGlobalReviewRevision: newMeta.source.lastGlobalReviewRevision,
    cleanupRequired,
    sync
  };
}

/**
 * A confirmed manifest with an empty write set is still a semantic declaration and must
 * be consumed exactly once, but only after the same final reload/verification as a real
 * seal. Any drift since confirmation aborts without consuming the manifest.
 */
async function consumeNoChange(
  context: KnowledgeWriteContext,
  manifest: ReviewManifest,
  conclusions: Map<string, ReviewConclusion>,
  sourceRevision: string,
  knowledgeBaseRevision: string,
  lastGlobalReviewRevision: string | null,
  testHooks?: SealTestHooks
): Promise<SealResult> {
  const indexPath = path.join(context.knowledgeGit.gitDir, "index");
  const indexObservation = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;
  if (testHooks?.beforeIndexLock) {
    await testHooks.beforeIndexLock();
  }
  const indexLock = acquireIndexLock(context.knowledgeGit);
  try {
    if (!indexStillMatches(indexPath, indexObservation)) {
      throw new KnowledgeError("E_KNOWLEDGE_INDEX_DIRTY", "The knowledge index changed before the manifest was consumed", {
        exitCode: 3,
        paths: [indexPath],
        remediation: "Another Git writer touched the index; re-run `llmdoc review`."
      });
    }
    if (testHooks?.beforePublish) {
      await testHooks.beforePublish();
    }
    const fresh = await reloadKnowledgeWriteContext(context);
    await assertReviewPreconditions(fresh);
    if (fresh.source.headRevision !== sourceRevision) {
      throw new KnowledgeError("E_SOURCE_HEAD_DRIFT", "The source HEAD changed before the manifest was consumed", {
        exitCode: 3,
        paths: [fresh.source.headRevision ?? "null", sourceRevision],
        remediation: "Re-run `llmdoc review` against the new source revision."
      });
    }
    if (fresh.knowledgeHead !== knowledgeBaseRevision || fresh.knowledgeBranch !== context.knowledgeBranch) {
      throw new KnowledgeError("E_KNOWLEDGE_HEAD_MISMATCH", "The knowledge HEAD or branch changed before the manifest was consumed", {
        exitCode: 3,
        paths: [fresh.knowledgeHead ?? "null", knowledgeBaseRevision],
        remediation: "Re-run `llmdoc review`; the knowledge branch moved."
      });
    }
    verifyManifestAgainstWorktree(fresh, manifest, conclusions);
    try {
      writeReviewManifest(context.knowledge.worktreeRoot, markReviewConsumed(manifest, knowledgeBaseRevision));
    } catch (error) {
      throw new KnowledgeError("E_KNOWLEDGE_WRITE_FAILED", `Failed to consume the review manifest: ${(error as Error).message}`, {
        exitCode: 70,
        paths: [context.knowledge.worktreeRoot]
      });
    }
    return {
      schema: "llmdoc.commit/v1",
      status: "no_change",
      reviewId: manifest.reviewId,
      repositoryId: context.entry.repositoryId,
      sourceRevision,
      knowledgeBaseRevision,
      knowledgeRevision: null,
      branch: context.knowledgeBranch,
      metaOnly: true,
      changedDocuments: [],
      refreshedDocuments: [],
      deletedDocuments: [],
      lastGlobalReviewRevision,
      cleanupRequired: false,
      sync: { index: "skipped", files: [], errors: [] }
    };
  } finally {
    indexLock.release();
  }
}

function assertManifestBinding(context: KnowledgeWriteContext, manifest: ReviewManifest): void {
  if (manifest.repositoryId !== context.entry.repositoryId) {
    throw new KnowledgeError("E_SOURCE_IDENTITY_MISMATCH", "The review manifest belongs to a different repository identity", {
      paths: [manifest.repositoryId, context.entry.repositoryId]
    });
  }
  if (
    path.resolve(manifest.sourceRoot) !== path.resolve(context.source.worktreeRoot) ||
    path.resolve(manifest.knowledgeRoot) !== path.resolve(context.knowledge.worktreeRoot)
  ) {
    throw invalidated("The review manifest binding does not match the current precise binding", [
      manifest.sourceRoot,
      manifest.knowledgeRoot
    ]);
  }
}

function verifyManifestAgainstWorktree(
  context: KnowledgeWriteContext,
  manifest: ReviewManifest,
  conclusions: Map<string, ReviewConclusion>
): void {
  const fresh = buildReviewItems(context, {});
  const freshById = new Map(fresh.map((item) => [item.id, item]));
  for (const item of fresh) {
    if (!manifest.documents.some((candidate) => candidate.id === item.id)) {
      throw invalidated(`Unreviewed knowledge content appeared after the review: ${item.id}`, [item.id]);
    }
  }
  for (const item of manifest.documents) {
    const current = freshById.get(item.id);
    if (current === undefined) {
      throw invalidated(`Reviewed document no longer matches the review candidate set: ${item.id}`, [item.id]);
    }
    if (
      current.action !== item.action ||
      current.oldDigest !== item.oldDigest ||
      current.candidateDigest !== item.candidateDigest ||
      !sameList(sorted(current.oldScope), sorted(item.oldScope)) ||
      !sameList(sorted(current.newScope), sorted(item.newScope)) ||
      JSON.stringify(current.oldValidatedRequires) !== JSON.stringify(item.oldValidatedRequires)
    ) {
      throw invalidated(`Reviewed document drifted after confirmation: ${item.id}`, [item.id]);
    }
  }
  const withRequires = attachCandidateRequires(context, manifest.documents, conclusions);
  const freshWriteSet = deriveWriteSet(withRequires, conclusions, manifest.advanceGlobalReview);
  if (JSON.stringify(freshWriteSet) !== JSON.stringify(manifest.writeSet)) {
    throw invalidated("The review write set drifted after confirmation", manifest.writeSet.documents);
  }
  for (const item of withRequires) {
    const currentRequires = currentCandidateRequires(context, item, conclusions);
    if (JSON.stringify(currentRequires) !== JSON.stringify(item.candidateRequires)) {
      throw invalidated(`Dependency digests drifted for ${item.id}`, [item.id]);
    }
  }
}

function currentCandidateRequires(
  context: KnowledgeWriteContext,
  item: ReviewDocumentItem,
  conclusions: Map<string, ReviewConclusion>
): Array<{ id: string; digest: string }> {
  const withRequires = attachCandidateRequires(context, [item], conclusions)[0]!;
  return withRequires.candidateRequires;
}

function buildNextMeta(
  context: KnowledgeWriteContext,
  manifest: ReviewManifest,
  conclusions: Map<string, ReviewConclusion>,
  sourceRevision: string
): KnowledgeMeta {
  const documents: Record<string, ValidatedEvidence> = {};
  for (const [id, evidence] of Object.entries(context.k0.meta?.documents ?? {})) {
    documents[id] = {
      validatedSourceRevision: evidence.validatedSourceRevision,
      validatedContentDigest: evidence.validatedContentDigest,
      validatedSourcePaths: [...evidence.validatedSourcePaths],
      validatedRequires: { ...evidence.validatedRequires }
    };
  }
  const withRequires = attachCandidateRequires(context, manifest.documents, conclusions);
  for (const item of withRequires) {
    const conclusion = conclusions.get(item.id) ?? "insufficient";
    if (conclusion === "insufficient") {
      continue;
    }
    if (item.action === "delete") {
      delete documents[item.id];
      continue;
    }
    const validatedRequires: Record<string, string> = {};
    for (const binding of item.candidateRequires) {
      validatedRequires[binding.id] = binding.digest;
    }
    documents[item.id] = {
      validatedSourceRevision: sourceRevision,
      validatedContentDigest: item.candidateDigest,
      validatedSourcePaths: sorted(item.newScope),
      validatedRequires
    };
  }
  return {
    schema: "llmdoc.meta/v3-ng",
    source: {
      repositoryId: context.entry.repositoryId,
      lastGlobalReviewRevision: manifest.advanceGlobalReview
        ? sourceRevision
        : (context.k0.meta?.source.lastGlobalReviewRevision ?? null)
    },
    documents
  };
}

async function reassertPublishPreconditions(
  context: KnowledgeWriteContext,
  sourceRevision: string,
  knowledgeBaseRevision: string
): Promise<void> {
  const { resolveSourceContext } = await import("./contexts.js");
  const source = await resolveSourceContext(context.source.worktreeRoot);
  if (source.headRevision !== sourceRevision) {
    throw new KnowledgeError("E_SOURCE_HEAD_DRIFT", "The source HEAD changed before publication", {
      exitCode: 3,
      paths: [source.headRevision ?? "null", sourceRevision]
    });
  }
  if (source.blockers.some((blocker) => blocker.code === "source_dirty")) {
    throw new KnowledgeError("E_SOURCE_DIRTY", "The source became dirty before publication", {
      exitCode: 3,
      paths: [context.source.worktreeRoot]
    });
  }
  const head = await runGit(context.knowledgeGit, ["rev-parse", "--verify", "HEAD^{commit}"], { allowMissing: true });
  const branch = await runGit(context.knowledgeGit, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowMissing: true });
  if (head !== knowledgeBaseRevision || branch !== context.knowledgeBranch) {
    throw new KnowledgeError("E_KNOWLEDGE_HEAD_MISMATCH", "The knowledge HEAD or branch changed before publication", {
      exitCode: 3,
      paths: [head ?? "null", knowledgeBaseRevision]
    });
  }
}

function buildCommitMessage(context: KnowledgeWriteContext, manifest: ReviewManifest, sourceRevision: string): string {
  const scope = new Set<string>();
  for (const item of manifest.documents) {
    const conclusion = item.conclusion ?? "insufficient";
    if (conclusion === "insufficient") {
      continue;
    }
    for (const entry of item.newScope) {
      scope.add(entry);
    }
    for (const entry of item.oldScope) {
      scope.add(entry);
    }
  }
  const verifiedScope = [...scope].sort().join(", ") || "(none)";
  return [
    `llmdoc: seal review ${manifest.reviewId.slice(0, 12)}`,
    "",
    `llmdoc-source-revision: ${sourceRevision}`,
    `llmdoc-verified-scope: ${verifiedScope}`,
    `llmdoc-review-id: ${manifest.reviewId}`
  ].join("\n");
}

function conditionalWrite(filePath: string, observation: Buffer | null, next: string | Buffer): boolean {
  let current: Buffer | null;
  try {
    current = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  } catch {
    return false;
  }
  const matches = (observation === null && current === null) || (observation !== null && current !== null && observation.equals(current));
  if (!matches) {
    return false;
  }
  try {
    const tempPath = `${filePath}.llmdoc-sync-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, next);
    fs.renameSync(tempPath, filePath);
    return true;
  } catch {
    return false;
  }
}

function indexStillMatches(indexPath: string, observation: Buffer | null): boolean {
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

function invalidated(message: string, paths: string[]): KnowledgeError {
  return new KnowledgeError("E_REVIEW_INVALIDATED", message, {
    exitCode: 3,
    paths,
    remediation: "Re-run `llmdoc review` so the manifest matches the current knowledge and source state."
  });
}

function removeIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // temp cleanup is best-effort
  }
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
