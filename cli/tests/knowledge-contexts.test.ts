import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import { resolveKnowledgeContext, resolveSourceContext } from "../src/lib/knowledge/contexts.js";
import { realPath, sameRealPath } from "../src/lib/knowledge/paths.js";

const createdDirs: string[] = [];

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort cleanup of temp fixtures
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function git(dir: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${dir}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

function gitAllowFail(dir: string, args: string[]): void {
  spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}

function initRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  return dir;
}

function writeFile(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commitFile(dir: string, rel: string, content: string, message: string): void {
  writeFile(dir, rel, content);
  git(dir, ["add", rel]);
  git(dir, ["commit", "-m", message]);
}

function head(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

async function expectKnowledgeError(run: () => unknown | Promise<unknown>, code: string, exitCode = 2): Promise<KnowledgeError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    const knowledgeError = error as KnowledgeError;
    expect(knowledgeError.code).toBe(code);
    expect(knowledgeError.exitCode).toBe(exitCode);
    return knowledgeError;
  }
  throw new Error(`expected KnowledgeError ${code}, but the call succeeded`);
}

const itOnWindows = process.platform === "win32" ? it : it.skip;

describe("resolveSourceContext", () => {
  it("resolves a clean source repository with a valid HEAD", async () => {
    const root = initRepo(makeTempDir("llmdoc-knowledge-src-"));
    commitFile(root, "src/api/retry.ts", "export function isRetryable() { return true; }\n", "init");

    const context = await resolveSourceContext(root);

    expect(context.kind).toBe("source");
    expect(context.worktreeRoot).toBe(realPath(root));
    expect(context.headRevision).toBe(head(root));
    expect(context.headUnborn).toBe(false);
    expect(context.clean).toBe(true);
    expect(context.blockers).toEqual([]);
    expect(context.repositoryId).toBeNull();
  });

  it("reports invalid_head for an unborn HEAD while the worktree is clean", async () => {
    const root = initRepo(makeTempDir("llmdoc-knowledge-unborn-"));

    const context = await resolveSourceContext(root);

    expect(context.headRevision).toBeNull();
    expect(context.headUnborn).toBe(true);
    expect(context.clean).toBe(true);
    expect(context.blockers.map((blocker) => blocker.code)).toEqual(["invalid_head"]);
  });

  it("reports invalid_head instead of a git error or fake clean when HEAD points at a non-commit object", async () => {
    const root = initRepo(makeTempDir("llmdoc-knowledge-blobhead-"));
    commitFile(root, "f.txt", "base\n", "base");
    writeFile(root, "blob-source.txt", "blob\n");
    const blobSha = git(root, ["hash-object", "-w", "blob-source.txt"]).trim();
    fs.writeFileSync(path.join(root, ".git", "refs", "heads", "main"), `${blobSha}\n`);

    const context = await resolveSourceContext(root);

    expect(context.headRevision).toBeNull();
    expect(context.headUnborn).toBe(false);
    expect(context.blockers.map((blocker) => blocker.code)).toEqual(["invalid_head"]);
    expect(context.clean).toBe(false);
    expect(context.cleanSnapshot.available).toBe(false);
    expect(context.cleanSnapshot.unavailableReason).toBeTruthy();
  });

  it("treats a detached HEAD at a real commit as a valid clean revision", async () => {
    const root = initRepo(makeTempDir("llmdoc-knowledge-detached-"));
    commitFile(root, "f.txt", "one\n", "c1");
    const first = head(root);
    commitFile(root, "f.txt", "two\n", "c2");
    git(root, ["checkout", "--detach", first]);

    const context = await resolveSourceContext(root);

    expect(context.headDetached).toBe(true);
    expect(context.headBranch).toBeNull();
    expect(context.headRevision).toBe(first);
    expect(context.clean).toBe(true);
    expect(context.cleanSnapshot.available).toBe(true);
    expect(context.blockers).toEqual([]);
  });

  it("categorizes staged, unstaged, untracked and conflicted paths as dirty", async () => {
    const root = initRepo(makeTempDir("llmdoc-knowledge-dirty-"));
    commitFile(root, "a.txt", "base\n", "base");
    writeFile(root, "a.txt", "unstaged change\n");
    writeFile(root, "b.txt", "staged\n");
    git(root, ["add", "b.txt"]);
    writeFile(root, "c.txt", "untracked\n");

    const context = await resolveSourceContext(root);

    expect(context.clean).toBe(false);
    expect(context.cleanSnapshot.stagedPaths).toEqual(["b.txt"]);
    expect(context.cleanSnapshot.unstagedPaths).toEqual(["a.txt"]);
    expect(context.cleanSnapshot.untrackedPaths).toEqual(["c.txt"]);
    expect(context.cleanSnapshot.conflictedPaths).toEqual([]);
    const dirty = context.blockers.find((blocker) => blocker.code === "source_dirty");
    expect(dirty).toBeDefined();
    expect(dirty!.paths).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("counts merge conflicts as dirty", async () => {
    const root = initRepo(makeTempDir("llmdoc-knowledge-conflict-"));
    commitFile(root, "f.txt", "base\n", "base");
    git(root, ["checkout", "-b", "feature"]);
    commitFile(root, "f.txt", "feature\n", "feature");
    git(root, ["checkout", "main"]);
    commitFile(root, "f.txt", "main\n", "main");
    gitAllowFail(root, ["merge", "--no-commit", "--no-ff", "feature"]);

    const context = await resolveSourceContext(root);

    expect(context.clean).toBe(false);
    expect(context.cleanSnapshot.conflictedPaths).toEqual(["f.txt"]);
  });

  it("treats a gitlink pointer change as outer dirt but ignores submodule-internal modifications", async () => {
    const outer = initRepo(makeTempDir("llmdoc-knowledge-outer-"));
    commitFile(outer, "README.md", "outer\n", "outer init");
    const nested = initRepo(path.join(outer, "vendor", "lib"));
    commitFile(nested, "lib.txt", "one\n", "nested c1");
    git(outer, ["update-index", "--add", "--cacheinfo", `160000,${head(nested)},vendor/lib`]);
    git(outer, ["commit", "-m", "register gitlink"]);

    expect((await resolveSourceContext(outer)).clean).toBe(true);

    writeFile(nested, "lib.txt", "uncommitted internal change\n");
    expect((await resolveSourceContext(outer)).clean).toBe(true);

    git(nested, ["add", "lib.txt"]);
    git(nested, ["commit", "-m", "nested c2"]);
    const context = await resolveSourceContext(outer);
    expect(context.clean).toBe(false);
    expect(context.cleanSnapshot.unstagedPaths).toEqual(["vendor/lib"]);
    expect(context.cleanSnapshot.untrackedPaths).toEqual([]);
  });

  it("leaves the source index and HEAD byte-identical across repeated reads", async () => {
    const root = initRepo(makeTempDir("llmdoc-knowledge-frozen-"));
    commitFile(root, "src/api/retry.ts", "export function isRetryable() { return true; }\n", "init");
    const indexPath = path.join(root, ".git", "index");
    const indexBefore = fs.readFileSync(indexPath);
    const headBefore = head(root);
    const statusBefore = git(root, ["status", "--porcelain"]);

    await resolveSourceContext(root);
    await resolveSourceContext(root);

    const indexAfter = fs.readFileSync(indexPath);
    expect(indexAfter.equals(indexBefore)).toBe(true);
    expect(head(root)).toBe(headBefore);
    expect(git(root, ["status", "--porcelain"])).toBe(statusBefore);
  });

  it("ignores repository-selection environment variables pointing at another repository", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-env-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const knowledgeRoot = initRepo(makeTempDir("llmdoc-knowledge-env-know-"));
    commitFile(knowledgeRoot, "README.md", "# knowledge\n", "init");
    const otherRoot = initRepo(makeTempDir("llmdoc-knowledge-env-other-"));
    commitFile(otherRoot, "other.txt", "other\n", "other init");

    const sourceIndexPath = path.join(sourceRoot, ".git", "index");
    const indexBefore = fs.readFileSync(sourceIndexPath);
    const pollutedIndex = path.join(otherRoot, ".git", "polluted-index");
    const otherHeadBefore = head(otherRoot);
    const sourceHeadBefore = head(sourceRoot);
    const previous = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE
    };
    process.env.GIT_DIR = path.join(otherRoot, ".git");
    process.env.GIT_WORK_TREE = otherRoot;
    process.env.GIT_INDEX_FILE = pollutedIndex;
    try {
      const source = await resolveSourceContext(sourceRoot);
      expect(source.worktreeRoot).toBe(realPath(sourceRoot));
      expect(source.headRevision).toBe(sourceHeadBefore);
      expect(source.clean).toBe(true);

      const knowledge = await resolveKnowledgeContext(knowledgeRoot, { source, mode: "external" });
      expect(knowledge.worktreeRoot).toBe(realPath(knowledgeRoot));
      expect(sameRealPath(knowledge.commonDir, realPath(path.join(knowledgeRoot, ".git")))).toBe(true);
    } finally {
      if (previous.GIT_DIR === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = previous.GIT_DIR;
      }
      if (previous.GIT_WORK_TREE === undefined) {
        delete process.env.GIT_WORK_TREE;
      } else {
        process.env.GIT_WORK_TREE = previous.GIT_WORK_TREE;
      }
      if (previous.GIT_INDEX_FILE === undefined) {
        delete process.env.GIT_INDEX_FILE;
      } else {
        process.env.GIT_INDEX_FILE = previous.GIT_INDEX_FILE;
      }
    }

    expect(fs.existsSync(pollutedIndex)).toBe(false);
    expect(fs.readFileSync(sourceIndexPath).equals(indexBefore)).toBe(true);
    expect(head(otherRoot)).toBe(otherHeadBefore);
  });

  it("fails closed with E_GIT_INVOCATION_FAILED when the outer Git index is corrupt", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-corrupt-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const nestedRoot = initRepo(path.join(sourceRoot, "knowledge"));
    commitFile(nestedRoot, "README.md", "# nested knowledge\n", "init");
    const source = await resolveSourceContext(sourceRoot);

    fs.writeFileSync(path.join(sourceRoot, ".git", "index"), "corrupt-index-bytes");

    await expectKnowledgeError(
      () => resolveKnowledgeContext(nestedRoot, { source, mode: "nested" }),
      "E_GIT_INVOCATION_FAILED",
      70
    );
  });

  it("rejects a bare repository and a non-Git directory", async () => {
    const bare = makeTempDir("llmdoc-knowledge-bare-");
    git(bare, ["init", "--bare"]);
    const plain = makeTempDir("llmdoc-knowledge-plain-");

    await expectKnowledgeError(() => resolveSourceContext(bare), "E_SOURCE_REPO_NOT_FOUND");
    await expectKnowledgeError(() => resolveSourceContext(plain), "E_SOURCE_REPO_NOT_FOUND");
    await expectKnowledgeError(() => resolveSourceContext(path.join(plain, "missing")), "E_SOURCE_REPO_NOT_FOUND");
  });
});

describe("resolveKnowledgeContext", () => {
  it("resolves an external knowledge repository disjoint from the source", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-ext-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const knowledgeRoot = initRepo(makeTempDir("llmdoc-knowledge-ext-know-"));
    commitFile(knowledgeRoot, "README.md", "# knowledge\n", "init");

    const source = await resolveSourceContext(sourceRoot);
    const knowledge = await resolveKnowledgeContext(knowledgeRoot, { source, mode: "external" });

    expect(knowledge.kind).toBe("knowledge");
    expect(knowledge.worktreeRoot).toBe(realPath(knowledgeRoot));
    expect(knowledge.docsRoot).toBe(path.join(realPath(knowledgeRoot), "docs"));
    expect(knowledge.metaPath).toBe(path.join(realPath(knowledgeRoot), ".llmdoc", "meta.json"));
    expect(knowledge.layoutVersion).toBe(1);
    expect(sameRealPath(knowledge.commonDir, source.commonDir)).toBe(false);
  });

  it("normalizes junction/symlink and relative-style knowledge roots to the worktree root", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-link-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const knowledgeRoot = initRepo(makeTempDir("llmdoc-knowledge-link-know-"));
    commitFile(knowledgeRoot, "README.md", "# knowledge\n", "init");

    const linkPath = path.join(path.dirname(knowledgeRoot), "link-to-know");
    fs.symlinkSync(knowledgeRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
    createdDirs.push(linkPath);

    const source = await resolveSourceContext(sourceRoot);
    const knowledge = await resolveKnowledgeContext(path.join(linkPath, "sub", "..") + path.sep, { source, mode: "external" });

    expect(knowledge.worktreeRoot).toBe(realPath(knowledgeRoot));
  });

  it("rejects a knowledge root without its own Git repository", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-nogit-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const emptyDir = makeTempDir("llmdoc-knowledge-nogit-know-");
    const source = await resolveSourceContext(sourceRoot);

    await expectKnowledgeError(() => resolveKnowledgeContext(emptyDir, { source, mode: "external" }), "E_KNOWLEDGE_REPO_NOT_FOUND");
    await expectKnowledgeError(
      () => resolveKnowledgeContext(path.join(emptyDir, "missing"), { source, mode: "external" }),
      "E_KNOWLEDGE_REPO_NOT_FOUND"
    );
  });

  it("rejects the source worktree itself and a linked worktree of the same repository", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-wt-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const linked = makeTempDir("llmdoc-knowledge-wt-linked-");
    git(sourceRoot, ["worktree", "add", linked]);
    createdDirs.push(linked);
    const source = await resolveSourceContext(sourceRoot);

    await expectKnowledgeError(() => resolveKnowledgeContext(sourceRoot, { source, mode: "external" }), "E_GIT_IDENTITY_CONFLICT");
    await expectKnowledgeError(() => resolveKnowledgeContext(linked, { source, mode: "external" }), "E_GIT_IDENTITY_CONFLICT");
  });

  it("accepts a linked worktree of a different repository (dotfile .git)", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-dot-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const other = initRepo(makeTempDir("llmdoc-knowledge-dot-other-"));
    commitFile(other, "README.md", "other\n", "init");
    const otherWorktree = makeTempDir("llmdoc-knowledge-dot-wt-");
    git(other, ["worktree", "add", otherWorktree]);
    createdDirs.push(otherWorktree);

    expect(fs.statSync(path.join(otherWorktree, ".git")).isFile()).toBe(true);

    const source = await resolveSourceContext(sourceRoot);
    const knowledge = await resolveKnowledgeContext(otherWorktree, { source, mode: "external" });
    expect(sameRealPath(knowledge.commonDir, source.commonDir)).toBe(false);
    expect(sameRealPath(knowledge.commonDir, realPath(path.join(other, ".git")))).toBe(true);
  });

  it("rejects a knowledge root that is a subdirectory of a knowledge worktree", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-sub-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const knowledgeRoot = initRepo(makeTempDir("llmdoc-knowledge-sub-know-"));
    commitFile(knowledgeRoot, "README.md", "# knowledge\n", "init");
    fs.mkdirSync(path.join(knowledgeRoot, "docs"));
    const source = await resolveSourceContext(sourceRoot);

    await expectKnowledgeError(
      () => resolveKnowledgeContext(path.join(knowledgeRoot, "docs"), { source, mode: "external" }),
      "E_KNOWLEDGE_ROOT_NOT_WORKTREE"
    );
  });

  it("requires explicit nested mode for a knowledge repository inside the source worktree", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-nest-src-"));
    commitFile(sourceRoot, ".gitignore", "knowledge/\n", "ignore knowledge");
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const nestedRoot = initRepo(path.join(sourceRoot, "knowledge"));
    commitFile(nestedRoot, "README.md", "# nested knowledge\n", "init");
    const source = await resolveSourceContext(sourceRoot);

    await expectKnowledgeError(
      () => resolveKnowledgeContext(nestedRoot, { source, mode: "external" }),
      "E_NESTED_MODE_REQUIRED"
    );

    const knowledge = await resolveKnowledgeContext(nestedRoot, { source, mode: "nested" });
    expect(knowledge.worktreeRoot).toBe(realPath(nestedRoot));
    expect(sameRealPath(knowledge.commonDir, source.commonDir)).toBe(false);
  });

  it(
    "rejects nested knowledge subtrees tracked by the outer Git as files or gitlinks",
    async () => {
    const trackedFilesSource = initRepo(makeTempDir("llmdoc-knowledge-track-src-"));
    commitFile(trackedFilesSource, "src/main.ts", "export {}\n", "init");
    commitFile(trackedFilesSource, "knowledge/README.md", "# plain docs first\n", "track knowledge subtree");
    const trackedNested = initRepo(path.join(trackedFilesSource, "knowledge"));
    const trackedSource = await resolveSourceContext(trackedFilesSource);
    expect(git(trackedFilesSource, ["ls-files", "--", "knowledge"])).toContain("knowledge/README.md");
    await expectKnowledgeError(
      () => resolveKnowledgeContext(trackedNested, { source: trackedSource, mode: "nested" }),
      "E_NESTED_TRACKED_BY_OUTER"
    );

    const gitlinkSource = initRepo(makeTempDir("llmdoc-knowledge-gitlink-src-"));
    commitFile(gitlinkSource, "src/main.ts", "export {}\n", "init");
    const gitlinkNested = initRepo(path.join(gitlinkSource, "knowledge"));
    commitFile(gitlinkNested, "README.md", "# nested\n", "init");
    git(gitlinkSource, ["update-index", "--add", "--cacheinfo", `160000,${head(gitlinkNested)},knowledge`]);
    const gitlinkSourceContext = await resolveSourceContext(gitlinkSource);
    await expectKnowledgeError(
      () => resolveKnowledgeContext(gitlinkNested, { source: gitlinkSourceContext, mode: "nested" }),
      "E_NESTED_TRACKED_BY_OUTER"
    );
    },
    30000
  );

  it("rejects a knowledge repository that contains the source worktree", async () => {
    const knowledgeRoot = initRepo(makeTempDir("llmdoc-knowledge-inv-know-"));
    commitFile(knowledgeRoot, "README.md", "# knowledge\n", "init");
    const sourceRoot = initRepo(path.join(knowledgeRoot, "embedded-source"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const source = await resolveSourceContext(sourceRoot);

    await expectKnowledgeError(() => resolveKnowledgeContext(knowledgeRoot, { source, mode: "external" }), "E_KNOWLEDGE_CONTAINS_SOURCE");
    await expectKnowledgeError(() => resolveKnowledgeContext(knowledgeRoot, { source, mode: "nested" }), "E_KNOWLEDGE_CONTAINS_SOURCE");
  });

  it("rejects nested mode when the knowledge root is outside the source worktree", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-misfit-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const knowledgeRoot = initRepo(makeTempDir("llmdoc-knowledge-misfit-know-"));
    commitFile(knowledgeRoot, "README.md", "# knowledge\n", "init");
    const source = await resolveSourceContext(sourceRoot);

    await expectKnowledgeError(
      () => resolveKnowledgeContext(knowledgeRoot, { source, mode: "nested" }),
      "E_NESTED_NOT_INSIDE_SOURCE"
    );
  });

  itOnWindows("matches knowledge roots that differ only by path case (Windows)", async () => {
    const sourceRoot = initRepo(makeTempDir("llmdoc-knowledge-case-src-"));
    commitFile(sourceRoot, "src/main.ts", "export {}\n", "init");
    const knowledgeRoot = initRepo(makeTempDir("llmdoc-knowledge-case-know-"));
    commitFile(knowledgeRoot, "README.md", "# knowledge\n", "init");

    const segments = knowledgeRoot.split(path.sep);
    const last = segments.pop()!;
    const first = last.charAt(0);
    const flipped = first === first.toUpperCase() ? first.toLowerCase() + last.slice(1) : first.toUpperCase() + last.slice(1);
    segments.push(flipped);
    const casedRoot = segments.join(path.sep);
    expect(casedRoot.toLowerCase()).toBe(knowledgeRoot.toLowerCase());

    const source = await resolveSourceContext(sourceRoot);
    const knowledge = await resolveKnowledgeContext(casedRoot, { source, mode: "external" });
    expect(knowledge.worktreeRoot).toBe(realPath(knowledgeRoot));
  });
});
