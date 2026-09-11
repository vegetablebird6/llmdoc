import fs from "node:fs";
import path from "node:path";

import { KnowledgeError, runFileSystemIo } from "./errors.js";
import { generateRepositoryId } from "./identity.js";
import { runGit, type GitRepoLayout } from "./git-core.js";
import { collectSourceRemotes, knowledgeConfigPath, renderKnowledgeLayoutConfig, type KnowledgeRemote } from "./knowledge-config.js";
import { isWithinRootReal, realPathViaExistingAncestor } from "./paths.js";
import {
  findBindingsByKnowledgeRoot,
  findBindingsBySourcePath,
  insertBinding,
  readRegistryDocument,
  resolveRegistryDir,
  withRegistryLock,
  writeRegistryDocument
} from "./registry.js";
import { resolveKnowledgeContext, resolveSourceContext } from "./contexts.js";

export interface InitOptions {
  sourceInput: string;
  knowledgeInput: string;
  nested?: boolean;
  registryDir?: string;
}

export interface InitResult {
  repositoryId: string;
  sourcePath: string;
  knowledgeRoot: string;
  knowledgeCommit: string;
}

const INIT_COMMIT_MESSAGE = "llmdoc: initialize knowledge repository";

const INIT_COMMIT_IDENTITY = {
  GIT_AUTHOR_NAME: "llmdoc",
  GIT_AUTHOR_EMAIL: "llmdoc@llmdoc.local",
  GIT_COMMITTER_NAME: "llmdoc",
  GIT_COMMITTER_EMAIL: "llmdoc@llmdoc.local"
};

const KNOWLEDGE_INIT_FILES = ["llmdoc.yaml", "README.md", ".gitignore", "docs/.gitkeep", "inbox/.gitkeep", ".llmdoc/meta.json"];

export async function initKnowledgeRepository(options: InitOptions): Promise<InitResult> {
  const source = await resolveSourceContext(options.sourceInput);
  const sourceLayout: GitRepoLayout = {
    worktreeRoot: source.worktreeRoot,
    gitDir: source.gitDir,
    commonDir: source.commonDir
  };
  const resolvedTarget = runFileSystemIo(
    () => realPathViaExistingAncestor(options.knowledgeInput),
    "Failed to resolve the init target path",
    [options.knowledgeInput]
  );
  const targetWithinSource = isWithinRootReal(source.worktreeRoot, resolvedTarget);
  if (targetWithinSource && !options.nested) {
    throw new KnowledgeError("E_NESTED_MODE_REQUIRED", "The new knowledge root is inside the source worktree, which requires the nested mode to be selected explicitly", {
      paths: [resolvedTarget, source.worktreeRoot],
      remediation: "Pass --nested to create a nested knowledge repository, or choose a root outside the source worktree (external is the default)."
    });
  }
  if (!targetWithinSource && options.nested) {
    throw new KnowledgeError("E_NESTED_NOT_INSIDE_SOURCE", "Nested mode was selected but the new knowledge root is not inside the source worktree", {
      paths: [resolvedTarget, source.worktreeRoot],
      remediation: "Use external mode for a knowledge repository outside the source worktree."
    });
  }
  assertInitTargetAvailable(resolvedTarget);

  const repositoryId = generateRepositoryId();
  const remotes = await collectSourceRemotes(sourceLayout);
  const registryDir = resolveRegistryDir(options.registryDir);

  return withRegistryLock(registryDir, async () => {
    const document = readRegistryDocument(registryDir);
    const existingForSource = findBindingsBySourcePath(document, source.worktreeRoot);
    if (existingForSource.length > 0) {
      throw new KnowledgeError("E_BINDING_CONFLICT", "This source worktree already has a binding; init never rebinds", {
        paths: existingForSource.map((entry) => entry.knowledgeRoot),
        remediation: "Use `llmdoc bind` for an existing association or remove the stale registry entry explicitly."
      });
    }
    const byKnowledge = findBindingsByKnowledgeRoot(document, resolvedTarget);
    if (byKnowledge.length > 0) {
      throw new KnowledgeError("E_BINDING_CONFLICT", "The knowledge root is already bound to another source path", {
        paths: byKnowledge.map((entry) => entry.sourcePath),
        remediation: "Each knowledge repository serves exactly one bound source worktree; choose another root or remove the stale registry entry explicitly."
      });
    }
    assertInitTargetAvailable(resolvedTarget);

    const createdTarget = !runFileSystemIo(
      () => fs.existsSync(resolvedTarget),
      "Failed to inspect the init target",
      [resolvedTarget]
    );
    if (createdTarget) {
      runFileSystemIo(() => fs.mkdirSync(resolvedTarget, { recursive: true }), "Failed to create the init target", [resolvedTarget]);
    }
    try {
      const target = runFileSystemIo(
        () => fs.realpathSync(resolvedTarget),
        "Failed to resolve the created init target",
        [resolvedTarget]
      );
      const bootstrapLayout: GitRepoLayout = {
        worktreeRoot: target,
        gitDir: path.join(target, ".git"),
        commonDir: path.join(target, ".git")
      };
      await runGit(bootstrapLayout, ["init"]);
      await runGit(bootstrapLayout, ["symbolic-ref", "HEAD", "refs/heads/main"]);

      const knowledge = await resolveKnowledgeContext(target, {
        source,
        mode: targetWithinSource ? "nested" : "external"
      });

      runFileSystemIo(
        () =>
          writeKnowledgeSkeleton({
            knowledgeRoot: knowledge.worktreeRoot,
            repositoryId,
            remotes
          }),
        "Failed to write the knowledge skeleton",
        [knowledge.worktreeRoot]
      );

      const knowledgeLayout: GitRepoLayout = {
        worktreeRoot: knowledge.worktreeRoot,
        gitDir: knowledge.gitDir,
        commonDir: knowledge.commonDir
      };
      await runGit(knowledgeLayout, ["add", "--", ...KNOWLEDGE_INIT_FILES]);
      const tree = await runGit(knowledgeLayout, ["write-tree"]);
      const commit = await runGit(knowledgeLayout, ["commit-tree", tree, "-m", INIT_COMMIT_MESSAGE], {
        env: INIT_COMMIT_IDENTITY
      });
      await runGit(knowledgeLayout, ["update-ref", "refs/heads/main", commit]);

      insertBinding(document, {
        repositoryId,
        sourcePath: source.worktreeRoot,
        knowledgeRoot: knowledge.worktreeRoot
      });
      writeRegistryDocument(registryDir, document);

      return {
        repositoryId,
        sourcePath: source.worktreeRoot,
        knowledgeRoot: knowledge.worktreeRoot,
        knowledgeCommit: commit
      };
    } catch (error) {
      await cleanupInitArtifacts(resolvedTarget, createdTarget);
      throw error;
    }
  });
}

const INIT_ARTIFACT_FILES = ["llmdoc.yaml", "README.md", ".gitignore"];
const INIT_ARTIFACT_DIRS = ["docs", "inbox", ".llmdoc"];

async function cleanupInitArtifacts(target: string, createdTarget: boolean): Promise<void> {
  const removeWithRetry = async (candidate: string, recursive: boolean): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fs.rmSync(candidate, { recursive, force: true });
        return;
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    }
  };
  try {
    await removeWithRetry(path.join(target, ".git"), true);
    for (const file of INIT_ARTIFACT_FILES) {
      await removeWithRetry(path.join(target, file), false);
    }
    for (const dir of INIT_ARTIFACT_DIRS) {
      const absolute = path.join(target, dir);
      if (fs.existsSync(absolute)) {
        for (const entry of fs.readdirSync(absolute)) {
          if (entry === ".gitkeep") {
            await removeWithRetry(path.join(absolute, entry), false);
          }
        }
        if (fs.readdirSync(absolute).length === 0) {
          await removeWithRetry(absolute, true);
        }
      }
    }
    if (createdTarget && fs.existsSync(target) && fs.readdirSync(target).length === 0) {
      await removeWithRetry(target, true);
    }
  } catch {
    // cleanup is best-effort; the original error is reported to the caller
  }
}

function assertInitTargetAvailable(targetInput: string): void {
  if (!fs.existsSync(targetInput)) {
    return;
  }
  runFileSystemIo(() => {
    const stat = fs.statSync(targetInput);
    if (!stat.isDirectory()) {
      throw new KnowledgeError("E_INIT_TARGET_NOT_EMPTY", "The init target exists and is not a directory", {
        paths: [targetInput],
        remediation: "Choose a new, empty target root for the knowledge repository."
      });
    }
    if (fs.readdirSync(targetInput).length > 0) {
      throw new KnowledgeError("E_INIT_TARGET_NOT_EMPTY", "The init target exists and is not empty; llmdoc never overwrites an existing target", {
        paths: [targetInput],
        remediation: "Choose a new, empty target root for the knowledge repository."
      });
    }
  }, "Failed to inspect the init target", [targetInput]);
}

function writeKnowledgeSkeleton(input: { knowledgeRoot: string; repositoryId: string; remotes: KnowledgeRemote[] }): void {
  fs.mkdirSync(path.join(input.knowledgeRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(input.knowledgeRoot, "inbox"), { recursive: true });
  fs.mkdirSync(path.join(input.knowledgeRoot, ".llmdoc"), { recursive: true });

  fs.writeFileSync(
    knowledgeConfigPath(input.knowledgeRoot),
    renderKnowledgeLayoutConfig({
      schema: "llmdoc.knowledge/v1",
      repositoryId: input.repositoryId,
      layoutVersion: 1,
      remotes: input.remotes
    })
  );
  fs.writeFileSync(
    path.join(input.knowledgeRoot, "README.md"),
    [
      "# Knowledge Base",
      "",
      "Generated navigation lives in the marked region below; the human-written area outside it is preserved.",
      "",
      "<!-- llmdoc:navigation:start -->",
      "<!-- llmdoc:navigation:end -->",
      ""
    ].join("\n")
  );
  fs.writeFileSync(path.join(input.knowledgeRoot, ".gitignore"), ".llmdoc-cache/\n");
  fs.writeFileSync(path.join(input.knowledgeRoot, "docs", ".gitkeep"), "");
  fs.writeFileSync(path.join(input.knowledgeRoot, "inbox", ".gitkeep"), "");
  fs.writeFileSync(
    path.join(input.knowledgeRoot, ".llmdoc", "meta.json"),
    `${JSON.stringify(
      {
        schema: "llmdoc.meta/v3-ng",
        source: {
          repositoryId: input.repositoryId,
          lastGlobalReviewRevision: null
        },
        documents: {}
      },
      null,
      2
    )}\n`
  );
}
