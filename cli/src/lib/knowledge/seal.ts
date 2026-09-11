import fs from "node:fs";
import path from "node:path";

import { KnowledgeError } from "./errors.js";
import { normalizeKnowledgeContent } from "./document.js";
import { readGitBlobs, runGit } from "./git-core.js";
import { addBlobToIndex, hashBlob, removeIndexPath } from "./git-write.js";
import { withKnowledgeLock } from "./lock.js";
import type { KnowledgeMeta, ValidatedEvidence } from "./meta.js";
import { renderNavigation, replaceNavigationRegion } from "./navigation.js";
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
  resolveKnowledgeWriteContext,
  type KnowledgeWriteContext
} from "./write-context.js";
import {
  indexStillMatches,
  publishKnowledgeCommit,
  readIndexObservation,
  type GeneratedFilePlan,
  type TransactionHooks
} from "./transaction.js";

const META_REPO_PATH = ".llmdoc/meta.json";

export type SealTestHooks = TransactionHooks;

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
  removedCandidates: string[];
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

  const generatedFiles: GeneratedFilePlan[] = [
    { repoPath: META_REPO_PATH, absolutePath: metaPath, observation: metaObservation, next: metaBytes }
  ];
  let readmePlan: GeneratedFilePlan | null = null;
  if (manifest.writeSet.generated.includes("README.md")) {
    const readmePath = path.join(context.knowledge.worktreeRoot, "README.md");
    const readmeObservation = fs.existsSync(readmePath) ? fs.readFileSync(readmePath) : null;
    const nextReadme = replaceNavigationRegion(
      readmeObservation === null ? null : readmeObservation.toString("utf8"),
      renderNavigation(context.worktreeModel)
    ).content;
    readmePlan = { repoPath: "README.md", absolutePath: readmePath, observation: readmeObservation, next: nextReadme };
    generatedFiles.push(readmePlan);
  }
  // Candidate removals are part of the published tree, so they must also be part of the
  // post-publish sync plan: K1 no longer contains the candidate, but a concurrent writer
  // may recreate the same inbox draft after the final verification. Deleting it must be
  // conditional on the seal-time observation, otherwise the new draft is either silently
  // lost or left untracked with cleanupRequired=false.
  for (const candidate of manifest.writeSet.candidates) {
    const candidatePath = path.join(context.knowledge.worktreeRoot, "inbox", candidate);
    const observation = fs.existsSync(candidatePath) ? fs.readFileSync(candidatePath) : null;
    generatedFiles.push({ repoPath: `inbox/${candidate}`, absolutePath: candidatePath, observation, remove: true });
  }
  const commitMessage = buildCommitMessage(context, manifest, sourceRevision);

  const result = await publishKnowledgeCommit({
    context,
    commitMessage,
    preLockCheck: (ctx) => reassertPublishPreconditions(ctx, sourceRevision, knowledgeBaseRevision),
    verifyFresh: async (fresh) => {
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
      assertGeneratedFilesUnchanged(generatedFiles);
    },
    buildIndex: async (tempIndex) => {
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
            const docPath = path.join(context.knowledge.docsRoot, item.id);
            generatedFiles.push({
              repoPath: `docs/${item.id}`,
              absolutePath: docPath,
              observation: Buffer.from(entry.raw, "utf8"),
              next: normalized
            });
          }
          const blob = await hashBlob(context.knowledgeGit, normalized);
          await addBlobToIndex(context.knowledgeGit, tempIndex, `docs/${item.id}`, blob);
        }
      }
      for (const candidate of manifest.writeSet.candidates) {
        await removeIndexPath(context.knowledgeGit, tempIndex, `inbox/${candidate}`);
      }
      const metaBlob = await hashBlob(context.knowledgeGit, metaBytes);
      await addBlobToIndex(context.knowledgeGit, tempIndex, META_REPO_PATH, metaBlob);
      if (readmePlan !== null && typeof readmePlan.next === "string") {
        const readmeBlob = await hashBlob(context.knowledgeGit, readmePlan.next);
        await addBlobToIndex(context.knowledgeGit, tempIndex, "README.md", readmeBlob);
      }
    },
    generatedFiles,
    afterPublish: (knowledgeRevision) => {
      try {
        writeReviewManifest(context.knowledge.worktreeRoot, markReviewConsumed(manifest, knowledgeRevision));
        return [];
      } catch (error) {
        return [`Failed to mark the manifest consumed: ${(error as Error).message}`];
      }
    },
    testHooks: options.testHooks
  });

  return {
    schema: "llmdoc.commit/v1",
    status: "success",
    reviewId: manifest.reviewId,
    repositoryId: context.entry.repositoryId,
    sourceRevision,
    knowledgeBaseRevision,
    knowledgeRevision: result.knowledgeRevision,
    branch: result.branch,
    metaOnly: manifest.writeSet.documents.length === 0 && manifest.writeSet.deletions.length === 0,
    changedDocuments: manifest.writeSet.documents,
    refreshedDocuments: manifest.writeSet.refresh,
    deletedDocuments: manifest.writeSet.deletions,
    removedCandidates: manifest.writeSet.candidates,
    lastGlobalReviewRevision: newMeta.source.lastGlobalReviewRevision,
    cleanupRequired: result.cleanupRequired,
    sync: result.sync
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
  const indexObservation = readIndexObservation(indexPath);
  if (testHooks?.beforeIndexLock) {
    await testHooks.beforeIndexLock();
  }
  const { acquireIndexLock } = await import("./git-write.js");
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
    const { reloadKnowledgeWriteContext } = await import("./write-context.js");
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
      removedCandidates: [],
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
  const freshWriteSet = deriveWriteSet(withRequires, conclusions, manifest.advanceGlobalReview, context);
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

function assertGeneratedFilesUnchanged(files: GeneratedFilePlan[]): void {
  for (const file of files) {
    const current = fs.existsSync(file.absolutePath) ? fs.readFileSync(file.absolutePath) : null;
    const matches =
      (file.observation === null && current === null) ||
      (file.observation !== null && current !== null && file.observation.equals(current));
    if (!matches) {
      throw invalidated(`A knowledge file changed after the review was confirmed: ${file.repoPath}`, [file.repoPath]);
    }
  }
}

function invalidated(message: string, paths: string[]): KnowledgeError {
  return new KnowledgeError("E_REVIEW_INVALIDATED", message, {
    exitCode: 3,
    paths,
    remediation: "Re-run `llmdoc review` so the manifest matches the current knowledge and source state."
  });
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
