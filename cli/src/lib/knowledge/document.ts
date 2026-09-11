import crypto from "node:crypto";
import path from "node:path";

import matter from "gray-matter";

import { extractLinks, extractTitle, estimateTokens } from "../markdown.js";
import { KnowledgeError } from "./errors.js";

export type KnowledgeKind = "architecture" | "decision" | "guide" | "reference";

export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = ["architecture", "decision", "guide", "reference"];

export interface KnowledgeSourceScope {
  paths: string[];
}

export interface KnowledgeRelations {
  requires?: string[];
  related?: string[];
  supersedes?: string[];
}

export interface KnowledgeFrontmatter {
  description: string;
  kind: KnowledgeKind;
  source: KnowledgeSourceScope;
  relations?: KnowledgeRelations;
}

export interface KnowledgeDocument {
  /** docs-relative POSIX path; this is the stable document ID. */
  id: string;
  absolutePath: string;
  frontmatter: KnowledgeFrontmatter;
  body: string;
  raw: string;
  normalized: string;
  contentDigest: string;
  title: string | null;
  links: string[];
  estimatedTokens: number;
  lineCount: number;
  topic: string | null;
}

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return typeof value === "string" && (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

/** CRLF/CR are unified to LF before any digest or Git blob comparison. */
export function normalizeKnowledgeContent(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

export function contentDigest(raw: string): string {
  const normalized = normalizeKnowledgeContent(raw);
  return `sha256:${crypto.createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

export function parseKnowledgeDocument(id: string, absolutePath: string, raw: string): KnowledgeDocument {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Front matter parse failed for ${id}: ${(error as Error).message}`, {
      paths: [absolutePath]
    });
  }
  const frontmatter = normalizeKnowledgeFrontmatter(parsed.data, id, absolutePath);
  const body = parsed.content.trim();
  const segments = id.split("/");
  return {
    id,
    absolutePath,
    frontmatter,
    body,
    raw,
    normalized: normalizeKnowledgeContent(raw),
    contentDigest: contentDigest(raw),
    title: extractTitle(parsed.content),
    links: extractLinks(parsed.content),
    estimatedTokens: estimateTokens(parsed.content),
    lineCount: normalizeKnowledgeContent(raw).split("\n").length,
    topic: segments.length > 1 ? (segments[0] ?? null) : null
  };
}

export function normalizeKnowledgeFrontmatter(input: unknown, id: string, absolutePath: string): KnowledgeFrontmatter {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} has no front matter mapping`, { paths: [absolutePath] });
  }
  const record = input as Record<string, unknown>;
  if (typeof record.description !== "string" || record.description.trim().length === 0) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} needs a non-empty description`, { paths: [absolutePath] });
  }
  if (!isKnowledgeKind(record.kind)) {
    throw new KnowledgeError(
      "E_DOCUMENT_INVALID",
      `Document ${id} has invalid kind "${String(record.kind)}"; allowed values: ${KNOWLEDGE_KINDS.join(", ")}`,
      { paths: [absolutePath] }
    );
  }
  const source = normalizeSourceScope(record.source, id, absolutePath);
  const relations = normalizeRelations(record.relations, id, absolutePath);
  const frontmatter: KnowledgeFrontmatter = {
    description: record.description,
    kind: record.kind,
    source
  };
  if (relations) {
    frontmatter.relations = relations;
  }
  return frontmatter;
}

function normalizeSourceScope(input: unknown, id: string, absolutePath: string): KnowledgeSourceScope {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} is missing the source.paths scope`, { paths: [absolutePath] });
  }
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.paths) || record.paths.length === 0) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} needs a non-empty source.paths list`, { paths: [absolutePath] });
  }
  const paths: string[] = [];
  for (const entry of record.paths) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} has a non-string source path`, { paths: [absolutePath] });
    }
    paths.push(entry.trim());
  }
  return { paths: dedupe(paths) };
}

function normalizeRelations(input: unknown, id: string, absolutePath: string): KnowledgeRelations | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} relations must be a mapping`, { paths: [absolutePath] });
  }
  const record = input as Record<string, unknown>;
  const relations: KnowledgeRelations = {};
  for (const key of ["requires", "related", "supersedes"] as const) {
    const value = record[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (!Array.isArray(value)) {
      throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} relations.${key} must be a list`, { paths: [absolutePath] });
    }
    relations[key] = dedupe(
      value.map((entry) => {
        if (typeof entry !== "string" || entry.trim().length === 0) {
          throw new KnowledgeError("E_DOCUMENT_INVALID", `Document ${id} relations.${key} has a non-string entry`, {
            paths: [absolutePath]
          });
        }
        return normalizeRelationTarget(entry);
      })
    );
  }
  return Object.keys(relations).length > 0 ? relations : undefined;
}

/**
 * Relations are canonicalized once at parse time so the model, validity, viewer,
 * context and search all consume the same single graph (no second normalization).
 */
export function normalizeRelationTarget(input: string): string {
  let value = input.trim().replaceAll("\\", "/");
  while (value.startsWith("./")) {
    value = value.slice(2);
  }
  return path.posix.normalize(value);
}

/**
 * Canonical POSIX form of a source evidence path. Returns null for entries that are not a
 * canonical repository-relative path (absolute, drive-qualified, escaping `..`, `.` or `..`
 * segments, empty segments, trailing separators, or backslash aliases). The single canonical
 * form prevents scope drift where `./a.ts`, `a.ts` and `a\\a.ts` would otherwise be distinct
 * evidence strings for the same target.
 */
export function canonicalizeSourcePath(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return null;
  }
  const replaced = trimmed.replaceAll("\\", "/");
  if (replaced.split("/").includes("..")) {
    return null;
  }
  const normalized = path.posix.normalize(replaced);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  const withoutTrailing = normalized.replace(/\/+$/, "");
  return withoutTrailing.length === 0 ? null : withoutTrailing;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Serializes a canonical knowledge document with the four allowed relation keys. */
export function renderKnowledgeDocumentContent(input: {
  kind: KnowledgeKind;
  description: string;
  sourcePaths: string[];
  requires?: readonly string[];
  related?: readonly string[];
  supersedes?: readonly string[];
  body: string;
}): string {
  const lines = ["---", `description: ${JSON.stringify(input.description)}`, `kind: ${input.kind}`, "source:", "  paths:"];
  for (const sourcePath of input.sourcePaths) {
    lines.push(`    - ${JSON.stringify(sourcePath)}`);
  }
  const relations: Array<[string, readonly string[]]> = [];
  if (input.requires && input.requires.length > 0) {
    relations.push(["requires", input.requires]);
  }
  if (input.related && input.related.length > 0) {
    relations.push(["related", input.related]);
  }
  if (input.supersedes && input.supersedes.length > 0) {
    relations.push(["supersedes", input.supersedes]);
  }
  if (relations.length > 0) {
    lines.push("relations:");
    for (const [key, targets] of relations) {
      lines.push(`  ${key}:`);
      for (const target of targets) {
        lines.push(`    - ${JSON.stringify(target)}`);
      }
    }
  }
  lines.push("---", "", input.body.trimEnd(), "");
  return lines.join("\n");
}
