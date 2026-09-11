import fs from "node:fs";
import path from "node:path";

import { KnowledgeError } from "./errors.js";
import { resolveKnowledgeContext, resolveSourceContext, type SourceContext } from "./contexts.js";
import { parseKnowledgeLayoutConfig, type KnowledgeLayoutConfig } from "./knowledge-config.js";
import {
  buildKnowledgeModelFromRaw,
  readFileSystemEntries,
  type KnowledgeIssue,
  type KnowledgeModel,
  type KnowledgeRawEntry
} from "./knowledge-model.js";
import { parseKnowledgeMeta, readKnowledgeMeta, type KnowledgeMeta } from "./meta.js";
import { isWithinRootReal } from "./paths.js";
import { findBindingsBySourcePath, readRegistryDocument, resolveRegistryDir } from "./registry.js";
import { listTreeFiles, probeGitLayout, readGitBlobs, runGit, type GitRepoLayout } from "./git-core.js";
import { computeValidity, type ValidityProjection } from "./validity.js";

export type ReadMode = "bound" | "explicit" | "unbound";

export interface LoadedKnowledge {
  mode: ReadMode;
  identityVerified: boolean;
  repositoryId: string | null;
  knowledgeRoot: string;
  docsRoot: string;
  metaPath: string;
  /** The fixed knowledge revision whose committed docs/meta/config were read; null for unbound filesystem reads. */
  knowledgeRevision: string | null;
  source: SourceContext | null;
  model: KnowledgeModel;
  meta: KnowledgeMeta | null;
  validity: ValidityProjection;
  issues: KnowledgeIssue[];
}

export interface LoadKnowledgeForReadInput {
  cwd?: string;
  sourceInput?: string;
  knowledgeInput?: string;
  registryDir?: string;
}

export interface KnowledgeSnapshot {
  knowledgeRoot: string;
  docsRoot: string;
  metaPath: string;
  knowledgeGit: GitRepoLayout | null;
  knowledgeRevision: string | null;
  entries: KnowledgeRawEntry[];
  meta: KnowledgeMeta | null;
  config: KnowledgeLayoutConfig | null;
  issues: KnowledgeIssue[];
}

/**
 * Read-only knowledge resolution. Never writes source or knowledge Git, never takes a
 * write lock, never initializes Git, and never falls back to the source repository as a
 * knowledge store. A formal Git read takes docs, meta and config from the same fixed
 * Knowledge HEAD; only an unbound no-Git directory is read from disk. Validity is only
 * claimed when a precise source/knowledge identity association is proven.
 */
export async function loadKnowledgeForRead(input: LoadKnowledgeForReadInput): Promise<LoadedKnowledge> {
  if (input.knowledgeInput !== undefined) {
    return loadExplicit(input.knowledgeInput, input.sourceInput, input.registryDir);
  }
  const sourceInput = input.sourceInput ?? input.cwd;
  if (sourceInput === undefined) {
    throw new KnowledgeError("E_SOURCE_REPO_NOT_FOUND", "A source root or an explicit knowledge root is required for reads", {
      remediation: "Pass --source <root> or --knowledge <root>."
    });
  }
  const source = await resolveSourceContext(sourceInput);
  const registry = readRegistryDocument(resolveRegistryDir(input.registryDir));
  const candidates = findBindingsBySourcePath(registry, source.worktreeRoot);
  if (candidates.length === 0) {
    throw new KnowledgeError("E_BINDING_NOT_FOUND", "No llmdoc binding exists for this source worktree", {
      paths: [source.worktreeRoot],
      remediation:
        "Run `llmdoc init`/`llmdoc bind`, or pass --knowledge <root> to read an explicit knowledge directory. Reads never fall back to the source Git."
    });
  }
  if (candidates.length > 1) {
    throw new KnowledgeError("E_BINDING_AMBIGUOUS", "The registry contains multiple bindings for this source worktree", {
      paths: candidates.map((entry) => entry.knowledgeRoot),
      remediation: "Disambiguate by editing the user registry so exactly one binding matches this source path."
    });
  }
  const entry = candidates[0]!;
  const mode = isWithinRootReal(source.worktreeRoot, entry.knowledgeRoot) ? "nested" : "external";
  const knowledge = await resolveKnowledgeContext(entry.knowledgeRoot, { source, mode });
  const snapshot = await readKnowledgeSnapshot(
    { worktreeRoot: knowledge.worktreeRoot, gitDir: knowledge.gitDir, commonDir: knowledge.commonDir },
    knowledge.worktreeRoot,
    knowledge.docsRoot,
    knowledge.metaPath
  );
  if (snapshot.config === null) {
    throw new KnowledgeError("E_KNOWLEDGE_NOT_INITIALIZED", "The bound knowledge repository has no llmdoc.yaml identity", {
      paths: [knowledge.worktreeRoot],
      remediation: "Initialize or migrate the knowledge repository before reading it as bound knowledge."
    });
  }
  if (snapshot.config.repositoryId !== entry.repositoryId) {
    throw new KnowledgeError("E_SOURCE_IDENTITY_MISMATCH", "The knowledge repository identity does not match the binding registry", {
      paths: [knowledge.worktreeRoot]
    });
  }
  assertMetaIdentity(snapshot.meta, snapshot.config.repositoryId, knowledge.metaPath);
  source.repositoryId = entry.repositoryId;
  return assemble({ mode: "bound", identityVerified: true, repositoryId: snapshot.config.repositoryId, source, snapshot });
}

async function loadExplicit(
  knowledgeInput: string,
  sourceInput: string | undefined,
  registryDir: string | undefined
): Promise<LoadedKnowledge> {
  const knowledgeRoot = resolveExistingDirectory(knowledgeInput);
  const source = sourceInput !== undefined ? await resolveSourceContext(sourceInput) : null;
  const probe = await probeGitLayout(knowledgeRoot);
  const knowledgeGit = probe.kind === "worktree" ? probe.layout : null;

  if (source !== null && knowledgeGit !== null) {
    // Reuse the M1 independence checks: distinct common Git, containment direction,
    // worktree-root equality. This rejects same-repo linked worktrees and subdirectories.
    const mode = isWithinRootReal(source.worktreeRoot, knowledgeRoot) ? "nested" : "external";
    const resolved = await resolveKnowledgeContext(knowledgeRoot, { source, mode });
    const snapshot = await readKnowledgeSnapshot(
      { worktreeRoot: resolved.worktreeRoot, gitDir: resolved.gitDir, commonDir: resolved.commonDir },
      resolved.worktreeRoot,
      resolved.docsRoot,
      resolved.metaPath
    );
    return resolveExplicitIdentity(snapshot, source, registryDir);
  }

  const snapshot = await readKnowledgeSnapshot(
    knowledgeGit,
    knowledgeRoot,
    path.join(knowledgeRoot, "docs"),
    path.join(knowledgeRoot, ".llmdoc", "meta.json")
  );
  const mode: ReadMode = snapshot.config !== null ? "explicit" : "unbound";
  return assemble({ mode, identityVerified: false, repositoryId: snapshot.config?.repositoryId ?? null, source, snapshot });
}

async function resolveExplicitIdentity(
  snapshot: KnowledgeSnapshot,
  source: SourceContext,
  registryDir: string | undefined
): Promise<LoadedKnowledge> {
  if (snapshot.config === null) {
    // Git knowledge without an identity cannot authorize validity.
    return assemble({ mode: "unbound", identityVerified: false, repositoryId: null, source, snapshot });
  }
  assertMetaIdentity(snapshot.meta, snapshot.config.repositoryId, snapshot.metaPath);
  const registry = readRegistryDocument(resolveRegistryDir(registryDir));
  const candidates = findBindingsBySourcePath(registry, source.worktreeRoot);
  if (candidates.length > 1) {
    throw new KnowledgeError("E_BINDING_AMBIGUOUS", "The registry contains multiple bindings for this source worktree", {
      paths: candidates.map((entry) => entry.knowledgeRoot),
      remediation: "Disambiguate by editing the user registry so exactly one binding matches this source path."
    });
  }
  const entry = candidates[0];
  if (entry === undefined) {
    // No precise association: content-only, never claim revision validity.
    return assemble({ mode: "explicit", identityVerified: false, repositoryId: snapshot.config.repositoryId, source, snapshot });
  }
  if (path.resolve(entry.knowledgeRoot) !== path.resolve(snapshot.knowledgeRoot)) {
    throw new KnowledgeError("E_BINDING_CONFLICT", "The explicit knowledge root conflicts with the existing binding for this source worktree", {
      paths: [snapshot.knowledgeRoot, entry.knowledgeRoot],
      remediation: "Use the bound knowledge root or update the binding explicitly; llmdoc does not auto-modify bindings."
    });
  }
  if (entry.repositoryId !== snapshot.config.repositoryId) {
    throw new KnowledgeError("E_SOURCE_IDENTITY_MISMATCH", "The knowledge repository identity does not match the binding registry", {
      paths: [snapshot.knowledgeRoot]
    });
  }
  source.repositoryId = entry.repositoryId;
  return assemble({ mode: "bound", identityVerified: true, repositoryId: entry.repositoryId, source, snapshot });
}

export async function readKnowledgeSnapshot(
  knowledgeGit: GitRepoLayout | null,
  knowledgeRoot: string,
  docsRoot: string,
  metaPath: string
): Promise<KnowledgeSnapshot> {
  if (!knowledgeGit) {
    const { entries, issues } = readFileSystemEntries(docsRoot);
    const { meta, issues: metaIssues } = readKnowledgeMeta(metaPath);
    const config = loadFsConfig(knowledgeRoot);
    return { knowledgeRoot, docsRoot, metaPath, knowledgeGit, knowledgeRevision: null, entries, meta, config, issues: [...issues, ...metaIssues] };
  }
  const head = await runGit(knowledgeGit, ["rev-parse", "--verify", "HEAD^{commit}"], { allowMissing: true });
  if (head === null) {
    return { knowledgeRoot, docsRoot, metaPath, knowledgeGit, knowledgeRevision: null, entries: [], meta: null, config: null, issues: [] };
  }
  const docFiles = (await listTreeFiles(knowledgeGit, head, "docs")).filter((file) => file.endsWith(".md"));
  const metaRepoPath = ".llmdoc/meta.json";
  const configRepoPath = "llmdoc.yaml";
  const blobs = await readGitBlobs(knowledgeGit, head, [...docFiles, metaRepoPath, configRepoPath]);
  const entries: KnowledgeRawEntry[] = docFiles.map((file) => ({
    id: file.slice("docs/".length),
    raw: blobs.get(file) ?? "",
    absolutePath: `${head}:${file}`
  }));
  const issues: KnowledgeIssue[] = [];
  let meta: KnowledgeMeta | null = null;
  const metaRaw = blobs.get(metaRepoPath);
  if (metaRaw !== undefined) {
    const parsed = parseKnowledgeMeta(metaRaw, `${head}:${metaRepoPath}`);
    meta = parsed.meta;
    issues.push(...parsed.issues);
  }
  let config: KnowledgeLayoutConfig | null = null;
  const configRaw = blobs.get(configRepoPath);
  if (configRaw !== undefined) {
    config = parseKnowledgeLayoutConfig(configRaw, `${head}:${configRepoPath}`);
  }
  return { knowledgeRoot, docsRoot, metaPath, knowledgeGit, knowledgeRevision: head, entries, meta, config, issues };
}

function loadFsConfig(knowledgeRoot: string): KnowledgeLayoutConfig | null {
  const filePath = path.join(knowledgeRoot, "llmdoc.yaml");
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return parseKnowledgeLayoutConfig(fs.readFileSync(filePath, "utf8"), filePath);
}

function assemble(input: {
  mode: ReadMode;
  identityVerified: boolean;
  repositoryId: string | null;
  source: SourceContext | null;
  snapshot: KnowledgeSnapshot;
}): Promise<LoadedKnowledge> {
  const { snapshot } = input;
  const model = buildKnowledgeModelFromRaw(snapshot.entries, snapshot.docsRoot);
  return computeValidity({
    model,
    meta: snapshot.meta,
    source: input.source,
    identityVerified: input.identityVerified,
    knowledgeRevision: snapshot.knowledgeRevision
  }).then((validity) => ({
    mode: input.mode,
    identityVerified: input.identityVerified,
    repositoryId: input.repositoryId,
    knowledgeRoot: snapshot.knowledgeRoot,
    docsRoot: snapshot.docsRoot,
    metaPath: snapshot.metaPath,
    knowledgeRevision: snapshot.knowledgeRevision,
    source: input.source,
    model,
    meta: snapshot.meta,
    validity,
    issues: [...snapshot.issues, ...model.issues, ...validity.issues]
  }));
}

function assertMetaIdentity(meta: KnowledgeMeta | null, repositoryId: string, label: string): void {
  if (meta !== null && meta.source.repositoryId !== repositoryId) {
    throw new KnowledgeError("E_SOURCE_IDENTITY_MISMATCH", "The knowledge meta ledger identity does not match the knowledge layout identity", {
      paths: [label]
    });
  }
}

function resolveExistingDirectory(input: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(input));
  } catch {
    throw new KnowledgeError("E_KNOWLEDGE_REPO_NOT_FOUND", `The explicit knowledge root does not exist (${input})`, {
      paths: [input]
    });
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new KnowledgeError("E_KNOWLEDGE_REPO_NOT_FOUND", `The explicit knowledge root is not a directory (${input})`, {
      paths: [input]
    });
  }
  return resolved;
}
