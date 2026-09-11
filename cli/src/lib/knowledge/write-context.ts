import { existsSync } from "node:fs";

import { KnowledgeError } from "./errors.js";
import { resolveWriteBinding, type PreciseBinding } from "./binding.js";
import {
  listTreeFiles,
  readCleanSnapshot,
  readHeadState,
  runGit,
  type CleanSnapshot,
  type GitRepoLayout,
  type HeadState
} from "./git-core.js";
import { buildKnowledgeModelFromRaw, type KnowledgeIssue, type KnowledgeModel } from "./knowledge-model.js";
import { isInboxCandidateId } from "./inbox.js";
import { readKnowledgeSnapshot, type KnowledgeSnapshot } from "./read.js";
import { resolveSourceContext, type KnowledgeContext, type SourceContext } from "./contexts.js";
import type { BindingEntry } from "./registry.js";
import { computeValidity, type ValidityProjection } from "./validity.js";

export type KnowledgeOperation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface KnowledgeWriteContext {
  source: SourceContext;
  knowledge: KnowledgeContext;
  entry: BindingEntry;
  knowledgeGit: GitRepoLayout;
  knowledgeHeadState: HeadState;
  knowledgeHead: string | null;
  knowledgeBranch: string | null;
  knowledgeOperation: KnowledgeOperation | null;
  knowledgeClean: CleanSnapshot;
  k0: KnowledgeSnapshot;
  worktree: KnowledgeSnapshot;
  k0Model: KnowledgeModel;
  worktreeModel: KnowledgeModel;
  validity: ValidityProjection;
  /** Committed inbox candidate ids at K0; used to compute promotion/rejection removals. */
  k0InboxIds: string[];
  issues: KnowledgeIssue[];
}

export interface ResolveKnowledgeWriteContextOptions {
  sourceInput: string;
  knowledgeInput?: string;
  nested?: boolean;
  registryDir?: string;
}

interface KnowledgeViews {
  k0: KnowledgeSnapshot;
  worktree: KnowledgeSnapshot;
  k0Model: KnowledgeModel;
  worktreeModel: KnowledgeModel;
  validity: ValidityProjection;
  k0InboxIds: string[];
}

/**
 * Resolves a precise write binding and both fixed views of the knowledge repository:
 * K0 (committed Knowledge HEAD) and the live worktree. All command surfaces that can
 * eventually write share this resolution so identity, staging and merge-state checks
 * are never re-implemented.
 */
export async function resolveKnowledgeWriteContext(
  options: ResolveKnowledgeWriteContextOptions
): Promise<KnowledgeWriteContext> {
  const binding: PreciseBinding = await resolveWriteBinding(options);
  const knowledgeGit: GitRepoLayout = {
    worktreeRoot: binding.knowledge.worktreeRoot,
    gitDir: binding.knowledge.gitDir,
    commonDir: binding.knowledge.commonDir
  };
  const knowledgeHeadState = await readHeadState(knowledgeGit);
  const knowledgeOperation = await detectKnowledgeOperation(knowledgeGit);
  const knowledgeClean = await readCleanSnapshot(knowledgeGit, { allowUnavailable: !knowledgeHeadState.pointsToCommit });
  const views = await assembleKnowledgeViews(binding.knowledge, knowledgeGit, binding.source);
  return {
    source: binding.source,
    knowledge: binding.knowledge,
    entry: binding.entry,
    knowledgeGit,
    knowledgeHeadState,
    knowledgeHead: views.k0.knowledgeRevision,
    knowledgeBranch: knowledgeHeadState.branch,
    knowledgeOperation,
    knowledgeClean,
    ...views,
    issues: [...views.k0.issues, ...views.k0Model.issues, ...views.validity.issues]
  };
}

/**
 * Re-reads the source revision, K0 and the knowledge worktree without touching the
 * knowledge index or its staging state. Used for the final pre-CAS verification while
 * the index lock is held, so concurrent content drift cannot be published unnoticed.
 */
export async function reloadKnowledgeWriteContext(context: KnowledgeWriteContext): Promise<KnowledgeWriteContext> {
  const source = await resolveSourceContext(context.source.worktreeRoot);
  const knowledgeHeadState = await readHeadState(context.knowledgeGit);
  const knowledgeOperation = await detectKnowledgeOperation(context.knowledgeGit);
  const views = await assembleKnowledgeViews(context.knowledge, context.knowledgeGit, source);
  return {
    ...context,
    source,
    knowledgeHeadState,
    knowledgeHead: views.k0.knowledgeRevision,
    knowledgeBranch: knowledgeHeadState.branch,
    knowledgeOperation,
    ...views,
    issues: [...views.k0.issues, ...views.k0Model.issues, ...views.validity.issues]
  };
}

async function assembleKnowledgeViews(
  knowledge: KnowledgeContext,
  knowledgeGit: GitRepoLayout,
  source: SourceContext
): Promise<KnowledgeViews> {
  const k0 = await readKnowledgeSnapshot(knowledgeGit, knowledge.worktreeRoot, knowledge.docsRoot, knowledge.metaPath);
  const worktree = await readKnowledgeSnapshot(null, knowledge.worktreeRoot, knowledge.docsRoot, knowledge.metaPath);
  const k0Model = buildKnowledgeModelFromRaw(k0.entries, knowledge.docsRoot);
  const worktreeModel = buildKnowledgeModelFromRaw(worktree.entries, knowledge.docsRoot);
  const validity = await computeValidity({
    model: k0Model,
    meta: k0.meta,
    source,
    identityVerified: true,
    knowledgeRevision: k0.knowledgeRevision
  });
  const k0InboxIds =
    k0.knowledgeRevision === null
      ? []
      : (await listTreeFiles(knowledgeGit, k0.knowledgeRevision, "inbox"))
          .filter((file) => file.startsWith("inbox/"))
          .map((file) => file.slice("inbox/".length))
          .filter((id) => isInboxCandidateId(id))
          .sort();
  return { k0, worktree, k0Model, worktreeModel, validity, k0InboxIds };
}

export async function detectKnowledgeOperation(layout: GitRepoLayout): Promise<KnowledgeOperation | null> {
  const probes: Array<{ file: string; operation: KnowledgeOperation }> = [
    { file: "MERGE_HEAD", operation: "merge" },
    { file: "REBASE_HEAD", operation: "rebase" },
    { file: "CHERRY_PICK_HEAD", operation: "cherry-pick" },
    { file: "REVERT_HEAD", operation: "revert" }
  ];
  for (const probe of probes) {
    const present = await runGit(layout, ["rev-parse", "--verify", "--quiet", probe.file], { allowMissing: true });
    if (present !== null) {
      return probe.operation;
    }
  }
  for (const directory of ["rebase-merge", "rebase-apply"]) {
    const present = await runGit(layout, ["rev-parse", "--git-path", directory], { allowMissing: true });
    if (present !== null && present.length > 0) {
      if (existsSync(present)) {
        return "rebase";
      }
    }
  }
  return null;
}

/**
 * The deterministic structural gate shared by review and seal. It runs the same
 * front matter / kind / relation / link / source scope evidence checks as `validate`
 * over the live worktree and refuses to advance on any structural error.
 */
export async function assertWorktreeStructureValid(context: KnowledgeWriteContext): Promise<void> {
  const worktreeValidity = await computeValidity({
    model: context.worktreeModel,
    meta: context.worktree.meta,
    source: context.source,
    identityVerified: true,
    knowledgeRevision: context.knowledgeHead
  });
  const errors = [
    ...context.worktree.issues,
    ...context.worktreeModel.issues,
    ...worktreeValidity.issues
  ].filter((issue) => issue.severity === "error");
  if (errors.length === 0) {
    return;
  }
  const codes = [...new Set(errors.map((issue) => issue.code))];
  throw new KnowledgeError(
    "E_STRUCTURE_INVALID",
    `The knowledge worktree has structural errors and cannot be reviewed or sealed: ${codes.join(", ")}`,
    {
      exitCode: 2,
      paths: [...new Set(errors.map((issue) => issue.path))],
      remediation: "Run `llmdoc validate`, fix the structural errors, then re-run `llmdoc review`."
    }
  );
}

/** Throws the frozen-protocol state blockers shared by review and seal. */
export async function assertReviewPreconditions(context: KnowledgeWriteContext): Promise<void> {
  const { source, knowledgeHeadState, knowledgeHead, knowledgeOperation, knowledgeClean } = context;
  if (source.blockers.some((blocker) => blocker.code === "invalid_head")) {
    throw new KnowledgeError("E_SOURCE_INVALID_HEAD", "Formal review requires a valid committed source HEAD snapshot", {
      exitCode: 3,
      paths: [source.worktreeRoot],
      remediation: "Commit or repair the source repository so HEAD resolves to a commit."
    });
  }
  if (source.blockers.some((blocker) => blocker.code === "source_dirty")) {
    throw new KnowledgeError("E_SOURCE_DIRTY", "Formal review requires a fully clean source worktree and index", {
      exitCode: 3,
      paths: [source.worktreeRoot],
      remediation: "Commit, stash or discard all staged, unstaged, untracked and conflicted source changes before reviewing."
    });
  }
  if (knowledgeHead === null || knowledgeHeadState.unborn || knowledgeHeadState.detached) {
    throw new KnowledgeError("E_KNOWLEDGE_NOT_ON_BRANCH", "Sealing requires the knowledge repository to have an initial commit on a branch", {
      exitCode: 3,
      paths: [context.knowledge.worktreeRoot],
      remediation: "Create an initial knowledge commit and check out a branch before reviewing."
    });
  }
  if (knowledgeOperation !== null) {
    throw new KnowledgeError("E_KNOWLEDGE_NOT_ON_BRANCH", `Sealing is blocked while a Git ${knowledgeOperation} is in progress`, {
      exitCode: 3,
      paths: [context.knowledge.worktreeRoot],
      remediation: "Finish or abort the in-progress operation before reviewing."
    });
  }
  if (!knowledgeClean.available || knowledgeClean.stagedPaths.length > 0) {
    throw new KnowledgeError("E_KNOWLEDGE_INDEX_DIRTY", "The knowledge index has staged content; llmdoc never unstages it", {
      exitCode: 3,
      paths: [...knowledgeClean.stagedPaths],
      remediation: "Commit, unstage or discard the staged knowledge changes; llmdoc does not modify the index on your behalf."
    });
  }
  await assertWorktreeStructureValid(context);
}

export type { SourceContext, KnowledgeContext };
