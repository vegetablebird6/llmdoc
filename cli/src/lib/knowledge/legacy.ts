import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { extractCodeRefs, resolveDocLink } from "../markdown.js";
import {
  canonicalizeSourcePath,
  isKnowledgeKind,
  renderKnowledgeDocumentContent,
  type KnowledgeKind
} from "./document.js";
import { KnowledgeError } from "./errors.js";
import { resolveSourceContext } from "./contexts.js";
import { normalizeDocTarget } from "./knowledge-model.js";
import { realPathViaExistingAncestor } from "./paths.js";

/**
 * Read-only reader for the legacy V3 knowledge layout (`llmdoc/*.mdx` + `llmdoc/meta.json`
 * + `llmdoc.config.json`). This module is reachable only from the explicit `migrate`
 * command; no runtime read/write entry point may import it. It never writes the legacy
 * repository, the source worktree or the migration target.
 */

export interface LegacyIssue {
  severity: "warning";
  code: string;
  path: string;
  message: string;
}

export interface LegacyDocumentPlan {
  legacyId: string;
  targetId: string | null;
  status: "converted" | "skipped" | "collision";
  kind: string | null;
  description: string | null;
  sourcePaths: string[];
  codeRefs: number;
  linksRewritten: number;
  requires: string[];
  related: string[];
  issues: LegacyIssue[];
  /** Converted body; omitted from the CLI output but used when executing the migration. */
  body: string;
}

export interface LegacyPlan {
  sourceRoot: string;
  legacyRoot: string;
  targetRoot: string;
  documents: LegacyDocumentPlan[];
  conflicts: string[][];
  issues: LegacyIssue[];
  legacyMeta: {
    schema: string | null;
    baselineRevision: string | null;
    validatedRevisions: Record<string, string | null>;
  } | null;
  config: { preload: string[] } | null;
  /** Byte digests of every legacy input, re-checked before the target is published/bound. */
  legacyDigests: Record<string, string>;
}

export interface PlanLegacyOptions {
  sourceInput: string;
  legacyInput?: string;
  targetInput: string;
}

interface ScannedDocument {
  legacyId: string;
  targetId: string | null;
  kind: KnowledgeKind | null;
  description: string | null;
  sourcePaths: string[];
  /** Content after CodeRef conversion, before link rewriting. */
  codeRefBody: string;
  codeRefs: number;
  rawRequires: unknown;
  rawRelated: unknown;
  issues: LegacyIssue[];
  skipped: boolean;
}

export async function planLegacyMigration(options: PlanLegacyOptions): Promise<LegacyPlan> {
  const source = await resolveSourceContext(options.sourceInput);
  const legacyRoot = resolveLegacyRoot(source.worktreeRoot, options.legacyInput);
  const targetRoot = realPathViaExistingAncestor(options.targetInput);
  const issues: LegacyIssue[] = [];

  const legacyMeta = readLegacyMeta(path.join(legacyRoot, "meta.json"), issues);
  const config = readLegacyConfig(path.join(source.worktreeRoot, "llmdoc.config.json"), issues);
  const legacyFiles = listMdxFiles(legacyRoot);
  // The complete legacy input set (every .mdx plus optional meta.json / llmdoc.config.json)
  // is captured once here and re-enumerated from scratch before the target is bound, so a
  // newly added or deleted input cannot slip past a digest-only comparison.
  const legacyDigests = collectLegacyInputDigests(source.worktreeRoot, legacyRoot);

  // Phase 1: parse and validate each document independently, and detect syntax that
  // cannot be expressed as plain Markdown (unknown JSX/MDX, unparseable CodeRef).
  const scanned = legacyFiles.map((legacyId) => scanDocument(legacyRoot, legacyId));
  const candidateTargets = scanned
    .filter((document) => !document.skipped && document.targetId !== null)
    .map((document) => document.targetId!);
  const conflicts = findTargetCollisions(candidateTargets);
  const collidedTargets = new Set(conflicts.flat());

  // Phase 2: the converted target set is the only set relations/links may point at.
  const convertedLegacyIds = new Set(
    scanned
      .filter((document) => !document.skipped && document.targetId !== null && !collidedTargets.has(document.targetId))
      .map((document) => document.legacyId)
  );
  const documents: LegacyDocumentPlan[] = scanned.map((document) =>
    resolveDocument(document, convertedLegacyIds, collidedTargets)
  );

  for (const group of conflicts) {
    issues.push(warning("legacy.target.collision", group.join(", "), `Multiple legacy documents map to the same target: ${group.join(", ")}`));
  }

  return {
    sourceRoot: source.worktreeRoot,
    legacyRoot,
    targetRoot,
    documents,
    conflicts,
    issues,
    legacyMeta,
    config,
    legacyDigests
  };
}

/** Renders the converted Markdown for a converted legacy document plan. */
export function renderMigratedDocument(plan: LegacyDocumentPlan): string {
  if (plan.kind === null || plan.description === null || plan.targetId === null || plan.status !== "converted") {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Cannot render a non-converted legacy document: ${plan.legacyId}`, {
      paths: [plan.legacyId]
    });
  }
  return renderKnowledgeDocumentContent({
    kind: plan.kind as KnowledgeKind,
    description: plan.description,
    sourcePaths: plan.sourcePaths,
    requires: plan.requires,
    related: plan.related,
    body: plan.body
  });
}

function scanDocument(legacyRoot: string, legacyId: string): ScannedDocument {
  const documentIssues: LegacyIssue[] = [];
  const base: ScannedDocument = {
    legacyId,
    targetId: normalizeTargetId(legacyId),
    kind: null,
    description: null,
    sourcePaths: [],
    codeRefBody: "",
    codeRefs: 0,
    rawRequires: undefined,
    rawRelated: undefined,
    issues: documentIssues,
    skipped: true
  };
  const filePath = path.join(legacyRoot, ...legacyId.split("/"));
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    documentIssues.push(warning("legacy.read.failed", legacyId, `Failed to read legacy document: ${(error as Error).message}`));
    return base;
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    documentIssues.push(warning("legacy.frontmatter.parse", legacyId, `Front matter parse failed: ${(error as Error).message}`));
    return base;
  }
  const data = parsed.data as {
    kind?: unknown;
    description?: unknown;
    code?: { paths?: unknown };
    relations?: { requires?: unknown; related?: unknown };
  };
  const kind = isKnowledgeKind(data.kind) ? data.kind : null;
  const description = typeof data.description === "string" && data.description.trim().length > 0 ? data.description : null;

  const sourcePaths: string[] = [];
  const addSourcePath = (value: unknown): void => {
    if (typeof value !== "string") {
      documentIssues.push(warning("legacy.code-path.invalid", legacyId, `Non-string code path ignored: ${String(value)}`));
      return;
    }
    const canonical = canonicalizeSourcePath(value);
    if (canonical === null) {
      documentIssues.push(warning("legacy.code-path.invalid", legacyId, `Non-canonical code path ignored: ${value}`));
      return;
    }
    if (!sourcePaths.includes(canonical)) {
      sourcePaths.push(canonical);
    }
  };
  if (Array.isArray(data.code?.paths)) {
    for (const entry of data.code.paths) {
      addSourcePath(entry);
    }
  }
  for (const codeRef of extractCodeRefs(parsed.content)) {
    addSourcePath(codeRef.path);
  }

  const codeRefConversion = convertCodeRefs(parsed.content);
  const unsupported = detectUnconvertibleSyntax(codeRefConversion.body);
  for (const problem of unsupported) {
    documentIssues.push(warning("legacy.conversion.unsupported", legacyId, problem));
  }

  if (base.targetId === null) {
    documentIssues.push(warning("legacy.target.invalid", legacyId, "Legacy path cannot be mapped to a canonical docs-relative .md id"));
  }
  if (kind === null) {
    documentIssues.push(warning("legacy.kind.invalid", legacyId, `Legacy kind is missing or unsupported: ${String(data.kind)}`));
  }
  if (description === null) {
    documentIssues.push(warning("legacy.description.missing", legacyId, "Legacy document has no non-empty description"));
  }
  if (sourcePaths.length === 0) {
    documentIssues.push(warning("legacy.source-scope.missing", legacyId, "Legacy document has no usable code.paths or CodeRef evidence scope"));
  }

  return {
    legacyId,
    targetId: base.targetId,
    kind,
    description,
    sourcePaths: [...sourcePaths].sort(),
    codeRefBody: codeRefConversion.body,
    codeRefs: codeRefConversion.codeRefs,
    rawRequires: data.relations?.requires,
    rawRelated: data.relations?.related,
    issues: documentIssues,
    skipped: base.targetId === null || kind === null || description === null || sourcePaths.length === 0 || unsupported.length > 0
  };
}

function resolveDocument(
  scanned: ScannedDocument,
  convertedLegacyIds: Set<string>,
  collidedTargets: Set<string>
): LegacyDocumentPlan {
  const collision = scanned.targetId !== null && collidedTargets.has(scanned.targetId);
  const status = scanned.skipped ? ("skipped" as const) : collision ? ("collision" as const) : ("converted" as const);
  if (status !== "converted") {
    return {
      legacyId: scanned.legacyId,
      targetId: scanned.targetId,
      status,
      kind: scanned.kind,
      description: scanned.description,
      sourcePaths: scanned.sourcePaths,
      codeRefs: scanned.codeRefs,
      linksRewritten: 0,
      requires: [],
      related: [],
      issues: scanned.issues,
      body: ""
    };
  }
  const requires = mapLegacyRelations(scanned.rawRequires, scanned.legacyId, convertedLegacyIds, scanned.issues, "requires");
  const related = mapLegacyRelations(scanned.rawRelated, scanned.legacyId, convertedLegacyIds, scanned.issues, "related");
  const links = convertLinks(scanned.codeRefBody, scanned.legacyId, convertedLegacyIds, scanned.issues);
  return {
    legacyId: scanned.legacyId,
    targetId: scanned.targetId,
    status,
    kind: scanned.kind,
    description: scanned.description,
    sourcePaths: scanned.sourcePaths,
    codeRefs: scanned.codeRefs,
    linksRewritten: links.linksRewritten,
    requires,
    related,
    issues: scanned.issues,
    body: links.body
  };
}

function resolveLegacyRoot(sourceRoot: string, legacyInput: string | undefined): string {
  const candidate = legacyInput ?? path.join(sourceRoot, "llmdoc");
  const resolved = realPathViaExistingAncestor(candidate);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new KnowledgeError("E_KNOWLEDGE_REPO_NOT_FOUND", `The legacy knowledge directory does not exist: ${candidate}`, {
      paths: [candidate],
      remediation: "Pass --legacy <dir> to point at the legacy llmdoc directory explicitly."
    });
  }
  return resolved;
}

function readLegacyMeta(metaPath: string, issues: LegacyIssue[]): LegacyPlan["legacyMeta"] {
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      schema?: unknown;
      baseline?: { revision?: unknown };
      documents?: Record<string, { validatedRevision?: unknown }>;
    };
    const validatedRevisions: Record<string, string | null> = {};
    for (const [id, entry] of Object.entries(parsed.documents ?? {})) {
      validatedRevisions[id] = typeof entry?.validatedRevision === "string" ? entry.validatedRevision : null;
    }
    return {
      schema: typeof parsed.schema === "string" ? parsed.schema : null,
      baselineRevision: typeof parsed.baseline?.revision === "string" ? parsed.baseline.revision : null,
      validatedRevisions
    };
  } catch (error) {
    issues.push(warning("legacy.meta.invalid", "meta.json", `Legacy meta.json could not be parsed: ${(error as Error).message}`));
    return null;
  }
}

function readLegacyConfig(configPath: string, issues: LegacyIssue[]): { preload: string[] } | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as { startup?: { preload?: unknown } };
    const preload = Array.isArray(parsed.startup?.preload)
      ? parsed.startup.preload.filter((entry): entry is string => typeof entry === "string")
      : [];
    return { preload };
  } catch (error) {
    issues.push(warning("legacy.config.invalid", "llmdoc.config.json", `Legacy config could not be parsed: ${(error as Error).message}`));
    return null;
  }
}

/**
 * Enumerates the complete legacy input set from disk and hashes every byte: every `.mdx`
 * under the legacy root plus optional `llmdoc/meta.json` and source `llmdoc.config.json`.
 * Plan and final verification call this exact function so the compared path set is always
 * the full current set, never just the files seen at plan time.
 */
export function collectLegacyInputDigests(sourceRoot: string, legacyRoot: string): Record<string, string> {
  const digestBytes = (bytes: Buffer): string => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  const digests: Record<string, string> = {};
  for (const legacyId of listMdxFiles(legacyRoot)) {
    digests[legacyId] = digestBytes(fs.readFileSync(path.join(legacyRoot, ...legacyId.split("/"))));
  }
  const metaPath = path.join(legacyRoot, "meta.json");
  if (fs.existsSync(metaPath)) {
    digests["meta.json"] = digestBytes(fs.readFileSync(metaPath));
  }
  const configPath = path.join(sourceRoot, "llmdoc.config.json");
  if (fs.existsSync(configPath)) {
    digests["llmdoc.config.json"] = digestBytes(fs.readFileSync(configPath));
  }
  return digests;
}

function listMdxFiles(root: string): string[] {
  const results: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        visit(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".mdx")) {
        results.push(path.relative(root, absolute).replaceAll(path.sep, "/"));
      }
    }
  };
  if (fs.existsSync(root)) {
    visit(root);
  }
  return results.sort();
}

function normalizeTargetId(legacyId: string): string | null {
  const withoutExtension = legacyId.slice(0, -".mdx".length);
  return normalizeDocTarget(`${withoutExtension}.md`);
}

function mapLegacyRelations(
  input: unknown,
  legacyId: string,
  convertedLegacyIds: Set<string>,
  issues: LegacyIssue[],
  relationKind: "requires" | "related"
): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const mapped: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") {
      issues.push(warning("legacy.relation.invalid", legacyId, `Non-string relation ignored: ${String(entry)}`));
      continue;
    }
    const normalized = normalizeDocTarget(entry.replace(/\.mdx$/i, ".md"));
    if (normalized === null) {
      issues.push(warning("legacy.relation.invalid", legacyId, `Relation target cannot be mapped: ${entry}`));
      continue;
    }
    const legacyTarget = `${normalized.slice(0, -".md".length)}.mdx`;
    if (!convertedLegacyIds.has(legacyTarget)) {
      // The target is skipped/colliding and will not exist in the target repository;
      // dropping the edge (with an explicit warning) is the only non-dangling option.
      issues.push(
        warning(
          "legacy.relation.target-skipped",
          legacyId,
          `relations.${relationKind} target is not part of the converted set and was removed: ${entry}`
        )
      );
      continue;
    }
    if (!mapped.includes(normalized)) {
      mapped.push(normalized);
    }
  }
  return mapped;
}

/**
 * Converts only CodeRef components the protocol can express losslessly: a self-closing tag
 * whose attributes are exactly static string literals `path` and optional `symbol`. Extra
 * attributes, dynamic `{...}` values, non-self-closing forms and a missing path are left
 * untouched (and reported as unconvertible); a partial conversion is never emitted.
 */
function convertCodeRefs(body: string): { body: string; codeRefs: number } {
  let codeRefs = 0;
  const converted = body.replace(/<CodeRef\b([^>]*?)(\/?)>/g, (whole: string, attributes: string, selfClosing: string) => {
    if (selfClosing !== "/") {
      return whole;
    }
    const parsed = parseStaticCodeRefAttributes(attributes);
    if (parsed === null || parsed.path === undefined) {
      return whole;
    }
    codeRefs += 1;
    return parsed.symbol !== undefined ? `\`${parsed.path}#${parsed.symbol}\`` : `\`${parsed.path}\``;
  });
  return { body: converted, codeRefs };
}

/**
 * Returns the attribute map only when every attribute is a static `name="value"` pair and
 * all names are protocol-allowed (`path`, `symbol`). Any dynamic `{...}` value, bare token,
 * or extra attribute yields null so the caller conservatively skips the document.
 */
function parseStaticCodeRefAttributes(input: string): Record<string, string> | null {
  if (input.includes("{") || input.includes("}")) {
    return null;
  }
  const allowed = new Set(["path", "symbol"]);
  const result: Record<string, string> = {};
  let consumed = "";
  const pattern = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    if (!allowed.has(match[1]!)) {
      return null;
    }
    result[match[1]!] = match[2]!;
    consumed += match[0];
  }
  if (input.replace(/[\s,]/g, "") !== consumed.replace(/[\s,]/g, "")) {
    return null;
  }
  return result;
}

/**
 * Detects syntax that plain Markdown cannot faithfully express. Any hit makes the
 * document conservatively `skipped`: parsing success is never treated as semantic
 * losslessness, and unknown components must not be silently published as converted.
 * Code fences and inline code are removed first so literal braces/components do not
 * produce false positives.
 */
function detectUnconvertibleSyntax(body: string): string[] {
  const problems: string[] = [];
  const scan = stripCodeRegions(body);
  if (/<CodeRef\b/.test(scan)) {
    problems.push("CodeRef could not be losslessly converted (missing/extra/dynamic attributes or not self-closing)");
  }
  if (/<\/?[A-Z][A-Za-z0-9._-]*/.test(scan)) {
    problems.push("An unsupported JSX/MDX component remains and cannot be represented as plain Markdown");
  }
  if (/^\s*(import|export)\s/m.test(scan)) {
    problems.push("An MDX import/export statement remains and cannot be represented as plain Markdown");
  }
  if (/<\/?>/.test(scan)) {
    problems.push("An MDX fragment remains and cannot be represented as plain Markdown");
  }
  if (/(?<!\\)\{[^}\n]*\}/.test(scan)) {
    problems.push("An MDX expression remains and cannot be represented as plain Markdown");
  }
  return problems;
}

/** Removes fenced code blocks and inline code spans before scanning for MDX/JSX syntax. */
function stripCodeRegions(body: string): string {
  return body.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/`[^`\n]*`/g, " ");
}

function convertLinks(
  body: string,
  legacyId: string,
  convertedLegacyIds: Set<string>,
  issues: LegacyIssue[]
): { body: string; linksRewritten: number } {
  let linksRewritten = 0;
  const converted = body.replace(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g, (whole: string, label: string, target: string) => {
    const [withoutAnchor, ...rest] = target.split("#");
    const anchorless = withoutAnchor ?? target;
    if (!/\.mdx$/i.test(anchorless)) {
      return whole;
    }
    const resolvedLegacy = resolveDocLink(legacyId, anchorless);
    if (!convertedLegacyIds.has(resolvedLegacy)) {
      // The link target is skipped/colliding: keep the visible label but drop the
      // dangling destination, and report it instead of fabricating a broken link.
      issues.push(
        warning("legacy.link.target-skipped", legacyId, `Body link target is not part of the converted set and was flattened: ${target}`)
      );
      return label;
    }
    linksRewritten += 1;
    const rewritten = `${anchorless.replace(/\.mdx$/i, ".md")}${rest.length > 0 ? `#${rest.join("#")}` : ""}`;
    return `[${label}](${rewritten})`;
  });
  return { body: converted, linksRewritten };
}

export function findTargetCollisions(targetIds: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const id of targetIds) {
    const key = process.platform === "win32" ? id.toLowerCase() : id;
    const bucket = groups.get(key) ?? [];
    bucket.push(id);
    groups.set(key, bucket);
  }
  return [...groups.values()].filter((bucket) => bucket.length > 1);
}

function warning(code: string, pathLabel: string, message: string): LegacyIssue {
  return { severity: "warning", code, path: pathLabel, message };
}
