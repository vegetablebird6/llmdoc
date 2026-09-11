import fs from "node:fs";
import path from "node:path";

import { KnowledgeError, runFileSystemIo } from "./errors.js";
import { generateRepositoryId } from "./identity.js";
import {
  listTreeFiles,
  probeGitLayout,
  readCleanSnapshot,
  readGitBlobs,
  readHeadState,
  runGit,
  type GitRepoLayout
} from "./git-core.js";
import {
  collectSourceRemotes,
  knowledgeConfigPath,
  loadKnowledgeLayoutConfig,
  renderKnowledgeLayoutConfig,
  type KnowledgeRemote
} from "./knowledge-config.js";
import { buildKnowledgeModel, buildKnowledgeModelFromRaw } from "./knowledge-model.js";
import { KNOWLEDGE_META_SCHEMA } from "./meta.js";
import { renderNavigation } from "./navigation.js";
import { isWithinRootReal, sameRealPath } from "./paths.js";
import { readKnowledgeSnapshot } from "./read.js";
import { detectKnowledgeOperation } from "./write-context.js";
import { resolveKnowledgeContext, resolveSourceContext, type KnowledgeContext } from "./contexts.js";
import {
  findBindingsByKnowledgeRoot,
  findBindingsBySourcePath,
  insertBinding,
  readRegistryDocument,
  resolveRegistryDir,
  withRegistryLock,
  writeRegistryDocument
} from "./registry.js";
import {
  collectLegacyInputDigests,
  planLegacyMigration,
  renderMigratedDocument,
  type LegacyDocumentPlan,
  type LegacyPlan
} from "./legacy.js";

export interface MigrateTestHooks {
  /** Injected race seam after target ownership is claimed and re-checked, before initialization. */
  beforeTargetInit?: () => void | Promise<void>;
  /** Injected failure seam just before the migrated target is validated. */
  beforeTargetValidate?: () => void | Promise<void>;
  /** Injected failure seam just before the user binding is written. */
  beforeRegistryWrite?: () => void | Promise<void>;
}

export interface MigrateOptions {
  sourceInput: string;
  legacyInput?: string;
  knowledgeInput: string;
  nested?: boolean;
  registryDir?: string;
  dryRun: boolean;
  testHooks?: MigrateTestHooks;
}

export interface MigrateResult {
  schema: "llmdoc.migrate/v1";
  status: "dry_run" | "migrated" | "already_migrated";
  dryRun: boolean;
  sourceRoot: string;
  legacyRoot: string;
  targetRoot: string;
  repositoryId: string | null;
  knowledgeCommit: string | null;
  bound: boolean;
  documents: LegacyDocumentSummary[];
  conflicts: string[][];
  issues: LegacyPlan["issues"];
  legacyMeta: LegacyPlan["legacyMeta"];
  config: LegacyPlan["config"];
}

export interface LegacyDocumentSummary {
  legacyId: string;
  targetId: string | null;
  status: LegacyDocumentPlan["status"];
  kind: string | null;
  description: string | null;
  sourcePaths: string[];
  codeRefs: number;
  linksRewritten: number;
  requires: string[];
  related: string[];
  issues: LegacyPlan["issues"];
}

const MIGRATION_COMMIT_MESSAGE = "llmdoc: migration baseline";

const MIGRATION_IDENTITY = {
  GIT_AUTHOR_NAME: "llmdoc",
  GIT_AUTHOR_EMAIL: "llmdoc@llmdoc.local",
  GIT_COMMITTER_NAME: "llmdoc",
  GIT_COMMITTER_EMAIL: "llmdoc@llmdoc.local"
};

/**
 * Explicit V3 migration. This is the only entry point allowed to read legacy `.mdx`,
 * CodeRef, `code.paths`, `llmdoc/meta.json` and `llmdoc.config.json`. A dry run performs
 * zero writes to the legacy repository, source worktree or target. A real run creates a
 * brand-new external knowledge Git with a fresh migration baseline (no subtree/history
 * extraction), converts documents conservatively (all validation evidence starts
 * unverified), validates the target, and only then writes the user binding.
 *
 * The complete legacy plan is (re)computed inside the registry lock and every legacy
 * input byte digest is re-checked before the target is validated and bound, so a legacy
 * edit that lands mid-migration aborts without binding or leaving a target behind.
 */
export async function migrateKnowledge(options: MigrateOptions): Promise<MigrateResult> {
  if (options.dryRun) {
    const plan = await planLegacyMigration({
      sourceInput: options.sourceInput,
      legacyInput: options.legacyInput,
      targetInput: options.knowledgeInput
    });
    return dryRunResult(plan);
  }

  const source = await resolveSourceContext(options.sourceInput);
  const sourceLayout: GitRepoLayout = {
    worktreeRoot: source.worktreeRoot,
    gitDir: source.gitDir,
    commonDir: source.commonDir
  };
  const registryDir = resolveRegistryDir(options.registryDir);
  return withRegistryLock(registryDir, async () => {
    // Recompute the full plan under the registry lock: the earlier dry-run plan (or any
    // caller-side plan) is never trusted for writing.
    const plan = await planLegacyMigration({
      sourceInput: options.sourceInput,
      legacyInput: options.legacyInput,
      targetInput: options.knowledgeInput
    });
    const summary = summarize(plan);
    const targetRoot = plan.targetRoot;
    const legacyRoot = plan.legacyRoot;
    assertMigrationRootsIsolated(source.worktreeRoot, legacyRoot, targetRoot, options.nested === true);

    const document = readRegistryDocument(registryDir);
    const existingForSource = findBindingsBySourcePath(document, source.worktreeRoot);
    if (existingForSource.length > 0) {
      const exact = existingForSource.find((entry) => sameRealPath(entry.knowledgeRoot, targetRoot));
      if (exact !== undefined) {
        if (await isInitializedKnowledgeRoot(targetRoot, exact.repositoryId)) {
          return alreadyMigrated(plan, exact.repositoryId, summary);
        }
        throw new KnowledgeError(
          "E_KNOWLEDGE_NOT_INITIALIZED",
          "The bound migration target is damaged and cannot be reported as already migrated",
          {
            paths: [targetRoot],
            remediation: "Repair the target knowledge repository or remove the binding explicitly; llmdoc never claims success on a damaged target."
          }
        );
      }
      throw new KnowledgeError("E_BINDING_CONFLICT", "This source worktree already has a binding; migration never rebinds or breaks an existing binding", {
        paths: existingForSource.map((entry) => entry.knowledgeRoot),
        remediation: "Remove the existing binding explicitly or migrate to a different source/target pair."
      });
    }
    const byKnowledge = findBindingsByKnowledgeRoot(document, targetRoot);
    if (byKnowledge.length > 0) {
      throw new KnowledgeError("E_BINDING_CONFLICT", "The migration target is already bound to another source worktree", {
        paths: byKnowledge.map((entry) => entry.sourcePath)
      });
    }
    assertTargetAvailable(targetRoot);

    let createdTarget = false;
    if (!fs.existsSync(targetRoot)) {
      runFileSystemIo(
        () => {
          fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
          fs.mkdirSync(targetRoot);
        },
        "Failed to create the migration target",
        [targetRoot]
      );
      createdTarget = true;
    }
    const lockPath = `${targetRoot}.llmdoc-migrate.lock`;
    let lockAcquired = false;
    let expected: Map<string, Buffer> = new Map();
    let knowledgeCommit: string;
    const repositoryId = generateRepositoryId();
    try {
      // Claim exclusive ownership of the empty target before initializing it, then re-check:
      // content that raced the availability check must not be silently adopted into the baseline.
      acquireTargetOwnership(lockPath, targetRoot);
      lockAcquired = true;
      assertTargetAvailable(targetRoot);
      if (options.testHooks?.beforeTargetInit) {
        await options.testHooks.beforeTargetInit();
      }

      await runGit({ worktreeRoot: targetRoot, gitDir: path.join(targetRoot, ".git"), commonDir: path.join(targetRoot, ".git") }, ["init"]);
      await runGit({ worktreeRoot: targetRoot, gitDir: path.join(targetRoot, ".git"), commonDir: path.join(targetRoot, ".git") }, [
        "symbolic-ref",
        "HEAD",
        "refs/heads/main"
      ]);
      const knowledge = await resolveKnowledgeContext(targetRoot, { source, mode: isWithinRootReal(source.worktreeRoot, targetRoot) ? "nested" : "external" });
      const knowledgeLayout: GitRepoLayout = {
        worktreeRoot: knowledge.worktreeRoot,
        gitDir: knowledge.gitDir,
        commonDir: knowledge.commonDir
      };

      const converted = plan.documents.filter((entry) => entry.status === "converted");
      const skipped = plan.documents.filter((entry) => entry.status !== "converted");
      for (const entry of skipped) {
        if (entry.targetId !== null) {
          plan.issues.push({
            severity: "warning",
            code: `legacy.document.${entry.status}`,
            path: entry.legacyId,
            message: `Legacy document was not migrated (${entry.status}); manual review required.`
          });
        }
      }

      const remotes = await collectSourceRemotes(sourceLayout);
      expected = writeMigratedSkeleton(knowledge.worktreeRoot, knowledge.docsRoot, knowledge.metaPath, repositoryId, remotes, converted);
      // Any path that appeared after our ownership check is external: never stage or adopt it.
      assertTargetContentsOwned(targetRoot, expected);

      await runGit(knowledgeLayout, ["add", "--", ...expected.keys()]);
      const tree = await runGit(knowledgeLayout, ["write-tree"]);
      knowledgeCommit = await runGit(knowledgeLayout, ["commit-tree", tree, "-m", MIGRATION_COMMIT_MESSAGE], {
        env: MIGRATION_IDENTITY
      });
      await runGit(knowledgeLayout, ["update-ref", "refs/heads/main", knowledgeCommit]);

      if (options.testHooks?.beforeTargetValidate) {
        await options.testHooks.beforeTargetValidate();
      }
      assertLegacyInputsUnchanged(plan, source.worktreeRoot);
      await assertMigratedTargetValid(knowledge, repositoryId, expected);

      if (options.testHooks?.beforeRegistryWrite) {
        await options.testHooks.beforeRegistryWrite();
      }
      // Re-enumerate the complete legacy input set one last time, immediately before the
      // binding is written. Revalidate the target in the same final window: neither the
      // legacy inputs nor the committed knowledge baseline may drift after the earlier
      // validation and still acquire a durable binding.
      assertLegacyInputsUnchanged(plan, source.worktreeRoot);
      await assertMigratedTargetValid(knowledge, repositoryId, expected);
      insertBinding(document, {
        repositoryId,
        sourcePath: source.worktreeRoot,
        knowledgeRoot: knowledge.worktreeRoot
      });
      writeRegistryDocument(registryDir, document);
    } catch (error) {
      const residual = await cleanupTarget(targetRoot, createdTarget, expected);
      if (residual.length > 0) {
        const original = error instanceof Error ? error.message : String(error);
        throw new KnowledgeError(
          "E_FILESYSTEM_IO",
          `Migration failed (${original}) and cleanup left residual artifacts`,
          {
            exitCode: 70,
            paths: residual,
            remediation: "Remove the residual paths manually; llmdoc reports incomplete cleanup instead of claiming a clean retry."
          }
        );
      }
      throw error;
    } finally {
      if (lockAcquired) {
        releaseTargetOwnership(lockPath);
      }
    }

    return {
      schema: "llmdoc.migrate/v1",
      status: "migrated",
      dryRun: false,
      sourceRoot: plan.sourceRoot,
      legacyRoot: plan.legacyRoot,
      targetRoot,
      repositoryId,
      knowledgeCommit,
      bound: true,
      documents: summary,
      conflicts: plan.conflicts,
      issues: plan.issues,
      legacyMeta: plan.legacyMeta,
      config: plan.config
    };
  });
}

function dryRunResult(plan: LegacyPlan): MigrateResult {
  return {
    schema: "llmdoc.migrate/v1",
    status: "dry_run",
    dryRun: true,
    sourceRoot: plan.sourceRoot,
    legacyRoot: plan.legacyRoot,
    targetRoot: plan.targetRoot,
    repositoryId: null,
    knowledgeCommit: null,
    bound: false,
    documents: summarize(plan),
    conflicts: plan.conflicts,
    issues: plan.issues,
    legacyMeta: plan.legacyMeta,
    config: plan.config
  };
}

function alreadyMigrated(plan: LegacyPlan, repositoryId: string, summary: LegacyDocumentSummary[]): MigrateResult {
  return {
    schema: "llmdoc.migrate/v1",
    status: "already_migrated",
    dryRun: false,
    sourceRoot: plan.sourceRoot,
    legacyRoot: plan.legacyRoot,
    targetRoot: plan.targetRoot,
    repositoryId,
    knowledgeCommit: null,
    bound: true,
    documents: summary,
    conflicts: plan.conflicts,
    issues: plan.issues,
    legacyMeta: plan.legacyMeta,
    config: plan.config
  };
}

/**
 * The migration target must never overlap the legacy knowledge tree. `target == legacy`,
 * `target` inside `legacy`, and `legacy` inside `target` are all rejected before any
 * mkdir/git init/cleanup can touch the old knowledge tree. Realpath/junction aware.
 */
function assertMigrationRootsIsolated(sourceRoot: string, legacyRoot: string, targetRoot: string, nested: boolean): void {
  if (sameRealPath(targetRoot, legacyRoot)) {
    throw new KnowledgeError("E_MIGRATION_TARGET_OVERLAP", "The migration target must not be the legacy knowledge root itself", {
      paths: [targetRoot, legacyRoot],
      remediation: "Choose a new, external target root that is separate from the legacy llmdoc directory."
    });
  }
  if (isWithinRootReal(legacyRoot, targetRoot)) {
    throw new KnowledgeError("E_MIGRATION_TARGET_OVERLAP", "The migration target must not live inside the legacy knowledge root", {
      paths: [targetRoot, legacyRoot],
      remediation: "Choose a target outside the legacy llmdoc directory so the old knowledge tree is never touched."
    });
  }
  if (isWithinRootReal(targetRoot, legacyRoot)) {
    throw new KnowledgeError("E_MIGRATION_TARGET_OVERLAP", "The legacy knowledge root must not live inside the migration target", {
      paths: [targetRoot, legacyRoot],
      remediation: "Choose a target that does not contain the legacy llmdoc directory."
    });
  }
  const targetWithinSource = isWithinRootReal(sourceRoot, targetRoot);
  if (targetWithinSource && !nested) {
    throw new KnowledgeError("E_NESTED_MODE_REQUIRED", "The migration target is inside the source worktree; pass --nested explicitly or choose an external target", {
      paths: [targetRoot, sourceRoot]
    });
  }
  if (!targetWithinSource && nested) {
    throw new KnowledgeError("E_NESTED_NOT_INSIDE_SOURCE", "Nested mode was selected but the migration target is not inside the source worktree", {
      paths: [targetRoot, sourceRoot]
    });
  }
}

/**
 * Re-enumerates the complete legacy input set and compares the path set plus every byte
 * digest against the plan. A modified, added or deleted input aborts; a digest-only check
 * over the plan-time file list would miss newly created or removed files.
 */
function assertLegacyInputsUnchanged(plan: LegacyPlan, sourceRoot: string): void {
  const expected = plan.legacyDigests;
  let fresh: Record<string, string>;
  try {
    fresh = collectLegacyInputDigests(sourceRoot, plan.legacyRoot);
  } catch {
    // A file vanishing or becoming unreadable mid-enumeration is itself a change.
    throw legacyChanged("legacy-input-set");
  }
  const expectedKeys = Object.keys(expected).sort();
  const freshKeys = Object.keys(fresh).sort();
  if (expectedKeys.join("\u0000") !== freshKeys.join("\u0000")) {
    const missing = expectedKeys.find((key) => !(key in fresh));
    const added = freshKeys.find((key) => !(key in expected));
    throw legacyChanged(missing ?? added ?? "legacy-input-set");
  }
  for (const key of expectedKeys) {
    if (expected[key] !== fresh[key]) {
      throw legacyChanged(key);
    }
  }
}

function legacyChanged(label: string): KnowledgeError {
  return new KnowledgeError("E_LEGACY_CHANGED", `The legacy input changed during migration: ${label}`, {
    exitCode: 3,
    paths: [label],
    remediation: "Re-run `llmdoc migrate` against the current legacy knowledge; llmdoc never binds a target converted from changing inputs."
  });
}

/**
 * already_migrated is only reported for a genuinely healthy target: valid committed HEAD
 * on a branch, no in-progress operation, matching repositoryId in config and meta, and a
 * structurally valid knowledge model. A damaged target must not report success.
 */
async function isInitializedKnowledgeRoot(targetRoot: string, repositoryId: string): Promise<boolean> {
  try {
    if (!fs.existsSync(path.join(targetRoot, ".git"))) {
      return false;
    }
    const probe = await probeGitLayout(targetRoot);
    if (probe.kind !== "worktree") {
      return false;
    }
    const layout = probe.layout;
    const headState = await readHeadState(layout);
    if (!headState.pointsToCommit || headState.detached || headState.branch === null) {
      return false;
    }
    if ((await detectKnowledgeOperation(layout)) !== null) {
      return false;
    }
    const config = loadKnowledgeLayoutConfig(targetRoot);
    if (config === null || config.repositoryId !== repositoryId) {
      return false;
    }
    const snapshot = await readKnowledgeSnapshot(
      layout,
      targetRoot,
      path.join(targetRoot, "docs"),
      path.join(targetRoot, ".llmdoc", "meta.json")
    );
    if (snapshot.knowledgeRevision === null || snapshot.config === null || snapshot.config.repositoryId !== repositoryId) {
      return false;
    }
    if (snapshot.meta === null || snapshot.meta.source.repositoryId !== repositoryId) {
      return false;
    }
    // Validate the committed snapshot, not the live worktree: uncommitted drafts are
    // allowed and must not make a healthy bound target look damaged.
    const model = buildKnowledgeModelFromRaw(snapshot.entries, snapshot.docsRoot);
    if (model.issues.some((issue) => issue.severity === "error")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function assertTargetAvailable(targetRoot: string): void {
  if (!fs.existsSync(targetRoot)) {
    return;
  }
  runFileSystemIo(() => {
    if (!fs.statSync(targetRoot).isDirectory()) {
      throw new KnowledgeError("E_INIT_TARGET_NOT_EMPTY", "The migration target exists and is not a directory", {
        paths: [targetRoot]
      });
    }
    if (fs.readdirSync(targetRoot).length > 0) {
      throw new KnowledgeError("E_INIT_TARGET_NOT_EMPTY", "The migration target exists and is not empty; llmdoc never overwrites an existing target or its drafts", {
        paths: [targetRoot],
        remediation: "Choose a new, empty target root, or re-run against the already-migrated bound target."
      });
    }
  }, "Failed to inspect the migration target", [targetRoot]);
}

/**
 * Writes the migration baseline and returns the exact repo-relative bytes it generated.
 * The map is later compared byte-for-byte against the committed HEAD tree, so the binding
 * can only be written for a target whose commit is precisely this baseline.
 */
function writeMigratedSkeleton(
  knowledgeRoot: string,
  docsRoot: string,
  metaPath: string,
  repositoryId: string,
  remotes: KnowledgeRemote[],
  converted: LegacyDocumentPlan[]
): Map<string, Buffer> {
  const expected = new Map<string, Buffer>();
  fs.mkdirSync(docsRoot, { recursive: true });
  fs.mkdirSync(path.join(knowledgeRoot, "inbox"), { recursive: true });
  fs.mkdirSync(path.join(knowledgeRoot, ".llmdoc"), { recursive: true });

  const configContent = renderKnowledgeLayoutConfig({ schema: "llmdoc.knowledge/v1", repositoryId, layoutVersion: 1, remotes });
  fs.writeFileSync(knowledgeConfigPath(knowledgeRoot), configContent);
  expected.set("llmdoc.yaml", Buffer.from(configContent, "utf8"));
  fs.writeFileSync(path.join(knowledgeRoot, ".gitignore"), ".llmdoc-cache/\n");
  expected.set(".gitignore", Buffer.from(".llmdoc-cache/\n", "utf8"));
  fs.writeFileSync(path.join(knowledgeRoot, "inbox", ".gitkeep"), "");
  expected.set("inbox/.gitkeep", Buffer.from("", "utf8"));

  const documents: Record<string, unknown> = {};
  for (const entry of converted) {
    const target = path.join(docsRoot, ...entry.targetId!.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = renderMigratedDocument(entry);
    fs.writeFileSync(target, content);
    expected.set(`docs/${entry.targetId!}`, Buffer.from(content, "utf8"));
    // Legacy revisions are provenance only; the new evidence tuple is conservatively
    // unverified until an explicit review/seal.
    documents[entry.targetId!] = {
      validatedSourceRevision: null,
      validatedContentDigest: null,
      validatedSourcePaths: [],
      validatedRequires: {}
    };
  }
  const metaContent = `${JSON.stringify({ schema: KNOWLEDGE_META_SCHEMA, source: { repositoryId, lastGlobalReviewRevision: null }, documents }, null, 2)}\n`;
  fs.writeFileSync(metaPath, metaContent);
  expected.set(".llmdoc/meta.json", Buffer.from(metaContent, "utf8"));

  // The migration baseline must carry real navigation, not an empty marked region:
  // rendering it in the same commit keeps README consistent from the first K.
  const model = buildKnowledgeModel(docsRoot);
  const readmeContent = `# Knowledge Base\n\nMigrated from legacy llmdoc; generated navigation lives in the marked region below.\n\n${renderNavigation(model)}\n`;
  fs.writeFileSync(path.join(knowledgeRoot, "README.md"), readmeContent);
  expected.set("README.md", Buffer.from(readmeContent, "utf8"));
  return expected;
}

/**
 * Validates the committed migration target, not just the live worktree: a valid HEAD on the
 * expected branch, no in-progress Git operation, an exact repositoryId in `llmdoc.yaml` and
 * `meta.source.repositoryId`, a structurally valid committed model, a HEAD tree byte-equal
 * to this run's baseline, and a fully clean worktree. Any tamper or drift aborts the binding.
 */
async function assertMigratedTargetValid(
  knowledge: KnowledgeContext,
  repositoryId: string,
  expected: Map<string, Buffer>
): Promise<void> {
  const targetRoot = knowledge.worktreeRoot;
  const layout: GitRepoLayout = {
    worktreeRoot: knowledge.worktreeRoot,
    gitDir: knowledge.gitDir,
    commonDir: knowledge.commonDir
  };
  const probe = await probeGitLayout(targetRoot);
  if (probe.kind !== "worktree") {
    throw invalidTarget("the migration target is not a Git worktree", targetRoot);
  }
  const headState = await readHeadState(layout);
  if (!headState.pointsToCommit || headState.detached || headState.branch !== "main") {
    throw invalidTarget("the migration target has no valid committed HEAD on branch main", targetRoot);
  }
  if ((await detectKnowledgeOperation(layout)) !== null) {
    throw invalidTarget("a Git operation is in progress in the migration target", targetRoot);
  }
  const worktreeConfig = loadKnowledgeLayoutConfig(targetRoot);
  if (worktreeConfig === null || worktreeConfig.repositoryId !== repositoryId) {
    throw invalidTarget("llmdoc.yaml is missing or its repositoryId does not match the generated identity", targetRoot);
  }
  const snapshot = await readKnowledgeSnapshot(layout, targetRoot, knowledge.docsRoot, knowledge.metaPath);
  if (snapshot.knowledgeRevision === null || snapshot.config === null || snapshot.config.repositoryId !== repositoryId) {
    throw invalidTarget("the committed llmdoc.yaml identity does not match the generated identity", targetRoot);
  }
  if (snapshot.meta === null || snapshot.meta.source.repositoryId !== repositoryId) {
    throw invalidTarget("the committed meta.source.repositoryId does not match the generated identity", targetRoot);
  }
  const model = buildKnowledgeModelFromRaw(snapshot.entries, knowledge.docsRoot);
  if (model.issues.some((issue) => issue.severity === "error")) {
    throw invalidTarget("the committed migration baseline has structural errors", targetRoot);
  }

  const treeFiles = await listTreeFiles(layout, snapshot.knowledgeRevision, ".");
  const committed = new Set(treeFiles);
  for (const repoPath of expected.keys()) {
    if (!committed.has(repoPath)) {
      throw invalidTarget(`the committed migration baseline is missing ${repoPath}`, targetRoot);
    }
  }
  for (const repoPath of committed) {
    if (!expected.has(repoPath)) {
      throw invalidTarget(`the committed migration baseline has an unexpected path: ${repoPath}`, targetRoot);
    }
  }
  const blobs = await readGitBlobs(layout, snapshot.knowledgeRevision, treeFiles);
  for (const [repoPath, bytes] of expected) {
    const content = blobs.get(repoPath);
    if (content === undefined || !Buffer.from(content, "utf8").equals(bytes)) {
      throw invalidTarget(`the committed migration baseline content differs at ${repoPath}`, targetRoot);
    }
  }

  const clean = await readCleanSnapshot(layout);
  if (!clean.available || !clean.clean) {
    throw invalidTarget("the migration target worktree is not clean", targetRoot);
  }
}

function invalidTarget(reason: string, targetRoot: string): KnowledgeError {
  return new KnowledgeError("E_KNOWLEDGE_NOT_INITIALIZED", `The migrated target failed validation and was not bound: ${reason}`, {
    exitCode: 3,
    paths: [targetRoot],
    remediation: "Re-run `llmdoc migrate` against a clean, empty target; llmdoc never binds a target it cannot verify."
  });
}

/** Claims exclusive ownership of the empty target with an atomic sibling lock file. */
function acquireTargetOwnership(lockPath: string, targetRoot: string): void {
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.closeSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new KnowledgeError("E_MIGRATION_TARGET_LOCKED", "Another migration already owns this target", {
        exitCode: 3,
        paths: [targetRoot, lockPath],
        remediation: "Wait for the other migration to finish, or remove the stale lock file if its owner has exited."
      });
    }
    throw new KnowledgeError("E_FILESYSTEM_IO", `Failed to acquire migration target ownership: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [lockPath]
    });
  }
}

function releaseTargetOwnership(lockPath: string): void {
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // best-effort ownership release
  }
}

/** Fails when the target contains any file this run did not generate (external bytes). */
function assertTargetContentsOwned(targetRoot: string, expected: Map<string, Buffer>): void {
  const unexpected: string[] = [];
  for (const file of listFilesRecursive(targetRoot)) {
    const relative = path.relative(targetRoot, file).replaceAll(path.sep, "/");
    if (relative.startsWith(".git/")) {
      continue;
    }
    if (!expected.has(relative)) {
      unexpected.push(file);
    }
  }
  if (unexpected.length > 0) {
    throw new KnowledgeError("E_MIGRATION_TARGET_DIRTY", "The migration target received external content during initialization", {
      exitCode: 70,
      paths: unexpected,
      remediation: "Remove or relocate the external paths; llmdoc never stages, adopts or deletes content it did not create."
    });
  }
}

/**
 * Removes only what this run generated and whose bytes still match the expected baseline.
 * `docs` is never recursively wiped: a file this run did not write (or that drifted) is
 * preserved and returned as a residual path. A target created by this run is removed only
 * once it is empty, so concurrently injected external bytes always survive.
 */
async function cleanupTarget(targetRoot: string, createdTarget: boolean, expected: Map<string, Buffer>): Promise<string[]> {
  const residual: string[] = [];
  const removeWithRetry = async (candidate: string, recursive: boolean): Promise<boolean> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fs.rmSync(candidate, { recursive, force: true });
        return true;
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    }
    return false;
  };

  // The `.git` directory is always created by this run (the target was empty beforehand).
  const gitDir = path.join(targetRoot, ".git");
  if (fs.existsSync(gitDir) && !(await removeWithRetry(gitDir, true))) {
    residual.push(gitDir);
  }

  for (const [repoPath, bytes] of expected) {
    const absolute = path.join(targetRoot, ...repoPath.split("/"));
    if (!fs.existsSync(absolute)) {
      continue;
    }
    let matches = false;
    try {
      matches = fs.readFileSync(absolute).equals(bytes);
    } catch {
      matches = false;
    }
    if (!matches) {
      residual.push(absolute);
      continue;
    }
    if (!(await removeWithRetry(absolute, false))) {
      residual.push(absolute);
    }
  }

  // Anything outside the generated baseline is external: preserve and report it.
  for (const file of listFilesRecursive(targetRoot)) {
    const relative = path.relative(targetRoot, file).replaceAll(path.sep, "/");
    if (relative.startsWith(".git/")) {
      continue;
    }
    if (!expected.has(relative)) {
      residual.push(file);
    }
  }

  for (const directory of listDirectoriesBottomUp(targetRoot)) {
    if (directory === targetRoot) {
      continue;
    }
    try {
      if (fs.readdirSync(directory).length === 0) {
        fs.rmdirSync(directory);
      }
    } catch {
      // best-effort empty-directory removal
    }
  }

  if (createdTarget) {
    try {
      if (fs.existsSync(targetRoot) && fs.readdirSync(targetRoot).length === 0) {
        fs.rmdirSync(targetRoot);
      }
    } catch {
      // best-effort root removal
    }
    if (fs.existsSync(targetRoot) && residual.length === 0) {
      residual.push(targetRoot);
    }
  }
  return [...new Set(residual)];
}

function listFilesRecursive(root: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else {
        files.push(absolute);
      }
    }
  };
  visit(root);
  return files;
}

function listDirectoriesBottomUp(root: string): string[] {
  const directories: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(path.join(current, entry.name));
      }
    }
    directories.push(current);
  };
  visit(root);
  return directories;
}

function summarize(plan: LegacyPlan): LegacyDocumentSummary[] {
  return plan.documents.map((document) => ({
    legacyId: document.legacyId,
    targetId: document.targetId,
    status: document.status,
    kind: document.kind,
    description: document.description,
    sourcePaths: document.sourcePaths,
    codeRefs: document.codeRefs,
    linksRewritten: document.linksRewritten,
    requires: document.requires,
    related: document.related,
    issues: document.issues
  }));
}
