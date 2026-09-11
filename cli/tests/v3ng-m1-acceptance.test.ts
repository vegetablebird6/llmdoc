import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

import { bindKnowledge } from "../src/lib/v3ng/bind.js";
import { resolveWriteBinding } from "../src/lib/v3ng/binding.js";
import { resolveSourceContext } from "../src/lib/v3ng/contexts.js";
import { initKnowledgeRepository } from "../src/lib/v3ng/init.js";
import { generateRepositoryId } from "../src/lib/v3ng/identity.js";
import { emptyRegistryDocument, insertBinding, readRegistryDocument, writeRegistryDocument } from "../src/lib/v3ng/registry.js";
import {
  commitFile,
  expectNgError,
  git,
  head,
  initRepo,
  makeTempDir,
  realPath,
  snapshotWorktree,
  sourceIndexBytes
} from "./v3ng-helpers.js";

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

function makeSource(prefix: string, withRemote = false): { base: string; registryDir: string; source: string } {
  const base = makeTempDir(prefix);
  createdDirs.push(base);
  const source = initRepo(`${base}/source`);
  if (withRemote) {
    git(source, ["remote", "add", "origin", "https://example.com/org/project.git"]);
  }
  commitFile(source, "src/main.ts", "export {}\n", "init");
  return { base, registryDir: `${base}/registry`, source };
}

function writeManualKnowledgeConfig(knowledgeRoot: string): string {
  const repositoryId = generateRepositoryId();
  fs.writeFileSync(
    path.join(knowledgeRoot, "llmdoc.yaml"),
    `schema: llmdoc.knowledge/v1\nrepositoryId: ${repositoryId}\nlayoutVersion: 1\nremotes: []\n`
  );
  return repositoryId;
}

describe("roadmap acceptance 1 (M1): source state is preserved byte-level across external init/bind", () => {
it(
    "keeps HEAD, index bytes, worktree files and status identical before and after the flows",
    async () => {
      const { base, registryDir, source } = makeSource("llmdoc-v3ng-acc1-", true);
      commitFile(source, "docs/note.md", "note\n", "docs");
      const sourceReal = realPath(source);
      const headBefore = head(source);
      const indexBefore = sourceIndexBytes(sourceReal);
      const filesBefore = snapshotWorktree(sourceReal);
      const statusBefore = git(sourceReal, ["status", "--porcelain"]);

      const init = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });
      await bindKnowledge({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });
      await resolveWriteBinding({ sourceInput: source, registryDir });
      await resolveSourceContext(sourceReal);
      await resolveSourceContext(sourceReal);

      expect(head(source)).toBe(headBefore);
      expect(sourceIndexBytes(sourceReal).equals(indexBefore)).toBe(true);
      expect(snapshotWorktree(sourceReal)).toEqual(filesBefore);
      expect(git(sourceReal, ["status", "--porcelain"])).toBe(statusBefore);
      expect((await resolveSourceContext(sourceReal)).clean).toBe(true);
      expect(init.knowledgeRoot).toBe(realPath(`${base}/knowledge`));
    },
    30000
  );
});

describe("roadmap acceptance 2 (M1): independence failures cannot be bypassed through bind", () => {
it(
    "blocks missing Git, upward source Git hits, same-repo worktrees, and tracked nested subtrees",
    async () => {
      const { base, registryDir, source } = makeSource("llmdoc-v3ng-acc2-");

    const plain = `${base}/plain`;
    fs.mkdirSync(plain);
    await expectNgError(() => bindKnowledge({ sourceInput: source, knowledgeInput: plain, registryDir }), "E_KNOWLEDGE_REPO_NOT_FOUND");

    await expectNgError(
      () => bindKnowledge({ sourceInput: source, knowledgeInput: source, registryDir }),
      "E_GIT_IDENTITY_CONFLICT"
    );

    const innerPlain = `${base}/source/inner-plain`;
    fs.mkdirSync(innerPlain);
    await expectNgError(
      () => bindKnowledge({ sourceInput: source, knowledgeInput: innerPlain, registryDir }),
      "E_KNOWLEDGE_ROOT_NOT_WORKTREE"
    );

    const linked = `${base}/linked-worktree`;
    git(source, ["worktree", "add", linked]);
    createdDirs.push(linked);
    await expectNgError(
      () => bindKnowledge({ sourceInput: source, knowledgeInput: linked, registryDir }),
      "E_GIT_IDENTITY_CONFLICT"
    );

    const other = initRepo(`${base}/other`);
    commitFile(other, "README.md", "other\n", "init");
    const otherLinked = `${base}/other-worktree`;
    git(other, ["worktree", "add", otherLinked]);
    createdDirs.push(otherLinked);
    writeManualKnowledgeConfig(otherLinked);
    const bound = await bindKnowledge({ sourceInput: source, knowledgeInput: otherLinked, registryDir });
    expect(bound.status).toBe("bound");

    await expectNgError(
      () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/second-knowledge`, registryDir }),
      "E_BINDING_CONFLICT"
    );
    expect(fs.existsSync(`${base}/second-knowledge`)).toBe(false);
    },
    30000
  );
it(
    "requires explicit nested selection and rejects outer-tracked nested subtrees",
    async () => {
      const { base, registryDir, source } = makeSource("llmdoc-v3ng-acc2n-");

      await expectNgError(
        () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/source/nk`, registryDir }),
        "E_NESTED_MODE_REQUIRED"
      );
      expect(fs.existsSync(`${base}/source/nk`)).toBe(false);

      const nested = await initKnowledgeRepository({
        sourceInput: source,
        knowledgeInput: `${base}/source/nk`,
        nested: true,
        registryDir
      });
      expect(nested.knowledgeRoot).toBe(realPath(`${base}/source/nk`));
      expect(readRegistryDocument(registryDir).bindings).toHaveLength(1);

      const fileTrackedRegistry = `${base}/registry2`;
      const trackedNestedDir = `${base}/source/tk`;
      fs.mkdirSync(trackedNestedDir, { recursive: true });
      fs.writeFileSync(path.join(trackedNestedDir, "outer-file.md"), "tracked by outer\n");
      git(source, ["add", "tk/outer-file.md"]);
      git(source, ["commit", "-m", "track nested subtree"]);
      initRepo(trackedNestedDir);
      await expectNgError(
        () => bindKnowledge({ sourceInput: source, knowledgeInput: trackedNestedDir, nested: true, registryDir: fileTrackedRegistry }),
        "E_NESTED_TRACKED_BY_OUTER"
      );

    const gitlinkRegistry = `${base}/registry3`;
    const gitlinkTarget = `${base}/source/tk2`;
    fs.mkdirSync(gitlinkTarget, { recursive: true });
    git(source, ["update-index", "--add", "--cacheinfo", `160000,${head(source)},tk2`]);
    await expectNgError(
      () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: gitlinkTarget, nested: true, registryDir: gitlinkRegistry }),
      "E_NESTED_TRACKED_BY_OUTER"
    );
    },
    30000
  );

  itOnWindows("treats junction and case-variant knowledge roots as the same binding", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-v3ng-acc2w-");
    const result = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir });

    const link = path.join(base, "know-link");
    fs.symlinkSync(result.knowledgeRoot, link, "junction");
    createdDirs.push(link);

    const rebound = await bindKnowledge({ sourceInput: source, knowledgeInput: link, registryDir });
    expect(rebound.status).toBe("already-bound");

    const segments = result.knowledgeRoot.split(path.sep);
    const last = segments.pop()!;
    const flipped = last === last.toUpperCase() ? last.toLowerCase() : last.toUpperCase();
    segments.push(flipped);
    const casedRoot = segments.join(path.sep);
    expect((await bindKnowledge({ sourceInput: source, knowledgeInput: casedRoot, registryDir })).status).toBe("already-bound");
  });
});

describe("roadmap acceptance 3 (M1): unrelated projects, clones, forks and ambiguous registries never share knowledge", () => {
  it("keeps two unrelated projects strictly separated", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-v3ng-acc3a-");
    const otherBase = makeTempDir("llmdoc-v3ng-acc3a2-");
    createdDirs.push(otherBase);
    const other = initRepo(`${otherBase}/source`);
    commitFile(other, "lib/x.ts", "export {}\n", "init");

    const k1 = await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/k1`, registryDir });
    const k2 = await initKnowledgeRepository({ sourceInput: other, knowledgeInput: `${otherBase}/k2`, registryDir });

    expect((await resolveWriteBinding({ sourceInput: source, registryDir })).knowledge.worktreeRoot).toBe(k1.knowledgeRoot);
    expect((await resolveWriteBinding({ sourceInput: other, registryDir })).knowledge.worktreeRoot).toBe(k2.knowledgeRoot);
    expect(k1.repositoryId).not.toBe(k2.repositoryId);
  });

  it("requires separate bindings for separate clones and rejects registry ambiguity", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-v3ng-acc3b-");
    await initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/k1`, registryDir });

    const clone = `${base}/clone`;
    git(source, ["clone", "--quiet", source, clone]);
    await expectNgError(() => resolveWriteBinding({ sourceInput: clone, registryDir }), "E_BINDING_NOT_FOUND");
    const cloneInit = await initKnowledgeRepository({ sourceInput: clone, knowledgeInput: `${base}/k2`, registryDir });
    expect((await resolveWriteBinding({ sourceInput: clone, registryDir })).knowledge.worktreeRoot).toBe(cloneInit.knowledgeRoot);

    const ambiguous = emptyRegistryDocument();
    insertBinding(ambiguous, { repositoryId: generateRepositoryId(), sourcePath: source, knowledgeRoot: `${base}/ka` });
    insertBinding(ambiguous, { repositoryId: generateRepositoryId(), sourcePath: source, knowledgeRoot: `${base}/kb` });
    writeRegistryDocument(registryDir, ambiguous);
    await expectNgError(() => resolveWriteBinding({ sourceInput: source, registryDir }), "E_BINDING_AMBIGUOUS");
  });

  it("gives forks and alias-sharing clones no identity: only explicit binding authorizes writes", async () => {
    const { base, registryDir } = makeSource("llmdoc-v3ng-acc3c-", true);
    const fork = initRepo(`${base}/fork`);
    git(fork, ["remote", "add", "origin", "https://example.com/org/project.git"]);
    commitFile(fork, "src/main.ts", "export {}\n", "init");

    const forkInit = await initKnowledgeRepository({ sourceInput: fork, knowledgeInput: `${base}/fork-knowledge`, registryDir });
    const forkConfig = fs.readFileSync(path.join(forkInit.knowledgeRoot, "llmdoc.yaml"), "utf8");
    expect(forkConfig).toContain("https://example.com/org/project.git");
    expect(forkConfig).not.toContain("user:secret");

    expect((await resolveWriteBinding({ sourceInput: fork, registryDir })).knowledge.worktreeRoot).toBe(forkInit.knowledgeRoot);
  });

  it("blocks init under a locked registry without touching the source", async () => {
    const { base, registryDir, source } = makeSource("llmdoc-v3ng-acc3d-");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(path.join(registryDir, "bindings.lock"), JSON.stringify({ ownerToken: "x", pid: 4321, host: "h" }));

    const headBefore = head(source);
    await expectNgError(
      () => initKnowledgeRepository({ sourceInput: source, knowledgeInput: `${base}/knowledge`, registryDir }),
      "E_REGISTRY_LOCKED",
      70
    );
    expect(head(source)).toBe(headBefore);
    expect(fs.existsSync(`${base}/knowledge`)).toBe(false);
  });
});

const itOnWindows = process.platform === "win32" ? it : it.skip;
