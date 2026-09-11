import path from "node:path";

import { KnowledgeError } from "./errors.js";
import {
  assertDirectory,
  probeGitLayout,
  readCleanSnapshot,
  readHeadState,
  runGit,
  type CleanSnapshot,
  type GitRepoLayout
} from "./git-core.js";
import { isWithinRootReal, sameRealPath } from "./paths.js";

export type SourceBlockerCode = "invalid_head" | "source_dirty" | "history_unavailable" | "diverged";

export interface SourceBlocker {
  code: SourceBlockerCode;
  message: string;
  paths: string[];
}

export interface SourceContext {
  kind: "source";
  worktreeRoot: string;
  gitDir: string;
  commonDir: string;
  repositoryId: string | null;
  headRevision: string | null;
  headBranch: string | null;
  headUnborn: boolean;
  headDetached: boolean;
  clean: boolean;
  cleanSnapshot: CleanSnapshot;
  blockers: SourceBlocker[];
}

export interface KnowledgeContext {
  kind: "knowledge";
  worktreeRoot: string;
  gitDir: string;
  commonDir: string;
  docsRoot: string;
  metaPath: string;
  layoutVersion: 1;
}

export type KnowledgeMode = "external" | "nested";

export interface ResolveKnowledgeOptions {
  source: SourceContext;
  mode: KnowledgeMode;
}

export async function resolveSourceContext(rootInput: string): Promise<SourceContext> {
  const root = assertDirectory(rootInput, "E_SOURCE_REPO_NOT_FOUND", "Source root does not exist or is not a directory");
  const probe = await probeGitLayout(root);
  if (probe.kind === "missing") {
    throw new KnowledgeError("E_SOURCE_REPO_NOT_FOUND", "No Git worktree found at the source root", {
      paths: [root],
      remediation: "Run the command from inside the source worktree or pass its worktree root."
    });
  }
  if (probe.kind === "bare") {
    throw new KnowledgeError("E_SOURCE_REPO_NOT_FOUND", "The source repository is bare and has no worktree", {
      paths: [probe.gitDir],
      remediation: "Bind a non-bare source worktree."
    });
  }
  const layout = probe.layout;
  const head = await readHeadState(layout);
  const snapshot = await readCleanSnapshot(layout, { allowUnavailable: !head.pointsToCommit });
  const blockers: SourceBlocker[] = [];
  if (head.headRevision === null) {
    let message: string;
    if (head.unborn) {
      message = "HEAD is unborn; the source repository has no commit yet.";
    } else if (head.rawHeadRevision !== null) {
      message =
        `HEAD resolves to ${head.rawHeadRevision}, which is not a commit object; ` +
        "a non-commit HEAD is not a valid source revision and must not be treated as one." +
        (snapshot.unavailableReason === null ? "" : ` Git status also failed: ${snapshot.unavailableReason}`);
    } else {
      message = "HEAD cannot be resolved to a commit.";
    }
    blockers.push({ code: "invalid_head", message, paths: [] });
  }
  if (snapshot.available && !snapshot.clean) {
    blockers.push({
      code: "source_dirty",
      message:
        "The source worktree/index is not clean: formal review and sealing require a fully committed snapshot " +
        "(staged, unstaged, non-ignored untracked and conflicted paths are all blockers).",
      paths: [...snapshot.stagedPaths, ...snapshot.unstagedPaths, ...snapshot.untrackedPaths, ...snapshot.conflictedPaths].sort()
    });
  }
  return {
    kind: "source",
    worktreeRoot: layout.worktreeRoot,
    gitDir: layout.gitDir,
    commonDir: layout.commonDir,
    repositoryId: null,
    headRevision: head.headRevision,
    headBranch: head.branch,
    headUnborn: head.unborn,
    headDetached: head.detached,
    clean: snapshot.clean,
    cleanSnapshot: snapshot,
    blockers
  };
}

export async function resolveKnowledgeContext(rootInput: string, options: ResolveKnowledgeOptions): Promise<KnowledgeContext> {
  const root = assertDirectory(rootInput, "E_KNOWLEDGE_REPO_NOT_FOUND", "Knowledge root does not exist or is not a directory");
  const probe = await probeGitLayout(root);
  if (probe.kind === "missing") {
    throw new KnowledgeError("E_KNOWLEDGE_REPO_NOT_FOUND", "No Git repository found at the knowledge root", {
      paths: [root],
      remediation: "Create an independent knowledge repository with `llmdoc init` or an explicit `git init`."
    });
  }
  if (probe.kind === "bare") {
    throw new KnowledgeError("E_KNOWLEDGE_REPO_NOT_FOUND", "The knowledge repository is bare and has no worktree", {
      paths: [probe.gitDir],
      remediation: "Use a non-bare knowledge worktree."
    });
  }
  const layout = probe.layout;
  if (!sameRealPath(layout.worktreeRoot, root)) {
    throw new KnowledgeError("E_KNOWLEDGE_ROOT_NOT_WORKTREE", "The knowledge root must be the knowledge Git worktree root itself", {
      paths: [root, layout.worktreeRoot],
      remediation: `Pass the worktree root of the knowledge repository (${layout.worktreeRoot}) instead of a subdirectory.`
    });
  }
  const sourceLayout: GitRepoLayout = {
    worktreeRoot: options.source.worktreeRoot,
    gitDir: options.source.gitDir,
    commonDir: options.source.commonDir
  };
  if (sameRealPath(layout.commonDir, sourceLayout.commonDir)) {
    throw new KnowledgeError("E_GIT_IDENTITY_CONFLICT", "The knowledge Git and the source Git share the same common directory; the knowledge repository is not independent", {
      paths: [layout.worktreeRoot, sourceLayout.worktreeRoot],
      remediation: "Create the knowledge repository as a separate Git repository (`git init` in a distinct root); a subdirectory of the source repository without its own Git, or a linked worktree of the same repository, is not acceptable."
    });
  }
  const knowledgeWithinSource = isWithinRootReal(sourceLayout.worktreeRoot, layout.worktreeRoot);
  const sourceWithinKnowledge = isWithinRootReal(layout.worktreeRoot, sourceLayout.worktreeRoot);
  if (knowledgeWithinSource) {
    if (options.mode !== "nested") {
      throw new KnowledgeError("E_NESTED_MODE_REQUIRED", "The knowledge root is inside the source worktree, which requires the nested mode to be selected explicitly", {
        paths: [layout.worktreeRoot, sourceLayout.worktreeRoot],
        remediation: "Pass mode \"nested\" to accept a nested knowledge repository, or move the knowledge repository outside the source worktree (external is the default)."
      });
    }
    await assertNestedSubtreeUntracked(sourceLayout, layout);
  } else if (sourceWithinKnowledge) {
    throw new KnowledgeError("E_KNOWLEDGE_CONTAINS_SOURCE", "The knowledge repository contains the source worktree; this containment direction is forbidden", {
      paths: [layout.worktreeRoot, sourceLayout.worktreeRoot],
      remediation: "Keep the source worktree outside the knowledge repository."
    });
  } else if (options.mode === "nested") {
    throw new KnowledgeError("E_NESTED_NOT_INSIDE_SOURCE", "Nested mode was selected but the knowledge root is not inside the source worktree", {
      paths: [layout.worktreeRoot, sourceLayout.worktreeRoot],
      remediation: "Use external mode for a knowledge repository outside the source worktree."
    });
  }
  return {
    kind: "knowledge",
    worktreeRoot: layout.worktreeRoot,
    gitDir: layout.gitDir,
    commonDir: layout.commonDir,
    docsRoot: path.join(layout.worktreeRoot, "docs"),
    metaPath: path.join(layout.worktreeRoot, ".llmdoc", "meta.json"),
    layoutVersion: 1
  };
}

async function assertNestedSubtreeUntracked(sourceLayout: GitRepoLayout, knowledgeLayout: GitRepoLayout): Promise<void> {
  const relative = path.relative(sourceLayout.worktreeRoot, knowledgeLayout.worktreeRoot).replaceAll(path.sep, "/");
  if (!relative || relative.startsWith("..")) {
    throw new KnowledgeError("E_NESTED_NOT_INSIDE_SOURCE", "The knowledge root is not a strict subtree of the source worktree", {
      paths: [knowledgeLayout.worktreeRoot, sourceLayout.worktreeRoot]
    });
  }
  const tracked = await runGit(sourceLayout, ["ls-files", "--", `:(literal)${relative}`]);
  if (tracked.trim().length > 0) {
    throw new KnowledgeError("E_NESTED_TRACKED_BY_OUTER", "The outer source Git already tracks the knowledge subtree (files or a submodule gitlink)", {
      paths: [relative],
      remediation: "The outer index must not track the knowledge subtree; llmdoc never modifies outer Git state, so remove the entries yourself or choose an external knowledge root."
    });
  }
}
