import fs from "node:fs";
import path from "node:path";

import { resolveDocLink } from "../markdown.js";
import { KnowledgeError } from "./errors.js";
import { canonicalizeSourcePath, parseKnowledgeDocument, type KnowledgeDocument } from "./document.js";

export interface KnowledgeIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface KnowledgeRawEntry {
  id: string;
  raw: string;
  absolutePath: string;
}

/** The single canonical relation graph consumed by every projection. */
export interface CanonicalRelations {
  requires: string[];
  related: string[];
  supersedes: string[];
}

const EMPTY_RELATIONS: CanonicalRelations = { requires: [], related: [], supersedes: [] };

export interface KnowledgeModel {
  docsRoot: string;
  documents: KnowledgeDocument[];
  byId: Map<string, KnowledgeDocument>;
  topics: Map<string, KnowledgeDocument[]>;
  rootSingletons: KnowledgeDocument[];
  /** The authoritative relation graph; missing/self/invalid edges are filtered out and recorded as issues. */
  relations: Map<string, CanonicalRelations>;
  /** ids whose declared requires has a structural problem (missing target, self-reference or invalid path). */
  requiresProblems: Set<string>;
  /** old document id -> ids of decisions that supersede it. */
  supersededBy: Map<string, string[]>;
  /** decision id -> old decision ids it supersedes. */
  supersedes: Map<string, string[]>;
  /** ids participating in a requires cycle. */
  cyclicIds: Set<string>;
  issues: KnowledgeIssue[];
}

export function relationsFor(model: KnowledgeModel, id: string): CanonicalRelations {
  return model.relations.get(id) ?? EMPTY_RELATIONS;
}

const SKIPPED_DIRS = new Set([".git", ".llmdoc-cache", ".llmdoc", "node_modules"]);

export function readFileSystemEntries(docsRoot: string): { entries: KnowledgeRawEntry[]; issues: KnowledgeIssue[] } {
  const entries: KnowledgeRawEntry[] = [];
  const issues: KnowledgeIssue[] = [];
  if (!fs.existsSync(docsRoot)) {
    return { entries, issues };
  }
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) {
          continue;
        }
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      const id = path.relative(docsRoot, absolute).split(path.sep).join("/");
      try {
        entries.push({ id, raw: fs.readFileSync(absolute, "utf8"), absolutePath: absolute });
      } catch (error) {
        issues.push({
          severity: "error",
          code: "document.unreadable",
          path: id,
          message: `Failed to read document: ${(error as Error).message}`
        });
      }
    }
  };
  visit(docsRoot);
  return { entries, issues };
}

export function parseRawEntries(entries: KnowledgeRawEntry[]): { documents: KnowledgeDocument[]; issues: KnowledgeIssue[] } {
  const issues: KnowledgeIssue[] = [];
  const documents: KnowledgeDocument[] = [];
  for (const entry of entries) {
    try {
      documents.push(parseKnowledgeDocument(entry.id, entry.absolutePath, entry.raw));
    } catch (error) {
      if (error instanceof KnowledgeError) {
        issues.push({ severity: "error", code: "document.invalid", path: entry.id, message: error.message });
        continue;
      }
      throw error;
    }
  }
  documents.sort((left, right) => left.id.localeCompare(right.id));
  return { documents, issues };
}

export function buildKnowledgeModel(docsRoot: string): KnowledgeModel {
  const { entries, issues } = readFileSystemEntries(docsRoot);
  const parsed = parseRawEntries(entries);
  return assembleModel([...issues, ...parsed.issues], parsed.documents, docsRoot);
}

export function buildKnowledgeModelFromRaw(entries: KnowledgeRawEntry[], docsRoot: string): KnowledgeModel {
  const parsed = parseRawEntries(entries);
  return assembleModel(parsed.issues, parsed.documents, docsRoot);
}

function assembleModel(seedIssues: KnowledgeIssue[], documents: KnowledgeDocument[], docsRoot: string): KnowledgeModel {
  const issues: KnowledgeIssue[] = [...seedIssues];
  const byId = new Map(documents.map((document) => [document.id, document]));
  const topics = new Map<string, KnowledgeDocument[]>();
  const rootSingletons: KnowledgeDocument[] = [];
  for (const document of documents) {
    if (document.topic) {
      const bucket = topics.get(document.topic) ?? [];
      bucket.push(document);
      topics.set(document.topic, bucket);
    } else {
      rootSingletons.push(document);
    }
  }
  for (const bucket of topics.values()) {
    bucket.sort((left, right) => left.id.localeCompare(right.id));
  }

  const relations = new Map<string, CanonicalRelations>();
  const requiresProblems = new Set<string>();
  const supersededBy = new Map<string, string[]>();
  const supersedes = new Map<string, string[]>();
  const requiresEdges = new Map<string, string[]>();
  const cyclicIds = new Set<string>();

  for (const document of documents) {
    const canonicalPaths: string[] = [];
    const seenPaths = new Set<string>();
    for (const rawPath of document.frontmatter.source.paths) {
      const canonical = canonicalizeSourcePath(rawPath);
      if (canonical === null || canonical !== rawPath.trim()) {
        issues.push({
          severity: "error",
          code: "source.paths.invalid",
          path: document.id,
          message: `source.paths must use the canonical repository-relative POSIX form (no absolute paths, .., . segments, backslashes or trailing separators): ${rawPath}`
        });
        continue;
      }
      if (!seenPaths.has(canonical)) {
        seenPaths.add(canonical);
        canonicalPaths.push(canonical);
      }
    }
    document.frontmatter.source.paths = canonicalPaths;

    for (const link of document.links) {
      const resolved = resolveDocLink(document.id, link);
      const normalized = normalizeDocTarget(resolved);
      if (!normalized || !normalized.endsWith(".md")) {
        continue;
      }
      if (!byId.has(normalized)) {
        issues.push({
          severity: "error",
          code: "link.missing",
          path: document.id,
          message: `Body link points to a missing document: ${link}`
        });
      }
    }

    const requires = normalizeTargets(document, "requires", issues, byId, { mustBeDecision: false });
    if (requires.rejected) {
      requiresProblems.add(document.id);
    }
    if (requires.accepted.length > 0) {
      requiresEdges.set(document.id, requires.accepted);
    }
    const related = normalizeTargets(document, "related", issues, byId, { mustBeDecision: false });
    const supersedesTargets = normalizeTargets(document, "supersedes", issues, byId, { mustBeDecision: true });
    if (supersedesTargets.accepted.length > 0) {
      supersedes.set(document.id, supersedesTargets.accepted);
      for (const target of supersedesTargets.accepted) {
        const bucket = supersededBy.get(target) ?? [];
        bucket.push(document.id);
        supersededBy.set(target, bucket);
      }
    }
    if (requires.accepted.length > 0 || related.accepted.length > 0 || supersedesTargets.accepted.length > 0) {
      relations.set(document.id, {
        requires: requires.accepted,
        related: related.accepted,
        supersedes: supersedesTargets.accepted
      });
    }
  }

  for (const ids of supersededBy.values()) {
    ids.sort((left, right) => left.localeCompare(right));
  }

  for (const cycle of findCycles(requiresEdges)) {
    for (const id of cycle) {
      cyclicIds.add(id);
    }
    issues.push({
      severity: "error",
      code: "relations.requires.cycle",
      path: cycle[0]!,
      message: `requires cycle detected: ${cycle.join(" -> ")}`
    });
  }
  // A supersedes cycle is a structural error only; it must not change document validity.
  for (const cycle of findCycles(supersedes)) {
    issues.push({
      severity: "error",
      code: "relations.supersedes.cycle",
      path: cycle[0]!,
      message: `supersedes cycle detected: ${cycle.join(" -> ")}`
    });
  }

  return { docsRoot, documents, byId, topics, rootSingletons, relations, requiresProblems, supersededBy, supersedes, cyclicIds, issues };
}

function normalizeTargets(
  document: KnowledgeDocument,
  key: "requires" | "related" | "supersedes",
  issues: KnowledgeIssue[],
  byId: Map<string, KnowledgeDocument>,
  options: { mustBeDecision: boolean }
): { accepted: string[]; rejected: boolean } {
  const declared = document.frontmatter.relations?.[key] ?? [];
  const accepted: string[] = [];
  let rejected = false;
  for (const rawTarget of declared) {
    const target = normalizeDocTarget(rawTarget);
    if (!target || !target.endsWith(".md")) {
      issues.push({
        severity: "error",
        code: `relations.${key}.invalid-path`,
        path: document.id,
        message: `relations.${key} target must be a docs-relative .md path: ${rawTarget}`
      });
      rejected = true;
      continue;
    }
    if (target === document.id) {
      issues.push({
        severity: "error",
        code: `relations.${key}.self`,
        path: document.id,
        message: `relations.${key} must not point at the document itself`
      });
      rejected = true;
      continue;
    }
    const targetDoc = byId.get(target);
    if (!targetDoc) {
      issues.push({
        severity: "error",
        code: `relations.${key}.missing`,
        path: document.id,
        message: `relations.${key} points to a missing document: ${rawTarget}`
      });
      rejected = true;
      continue;
    }
    if (options.mustBeDecision && targetDoc.frontmatter.kind !== "decision") {
      issues.push({
        severity: "error",
        code: "relations.supersedes.target-kind",
        path: document.id,
        message: `relations.supersedes target must be a decision: ${rawTarget}`
      });
      rejected = true;
      continue;
    }
    accepted.push(target);
  }
  return { accepted: [...new Set(accepted)], rejected };
}

export function normalizeDocTarget(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    return null;
  }
  return normalized;
}

/** Returns each cycle as a list of ids, using a deterministic DFS over the edge map. */
function findCycles(edges: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const seenCycles = new Set<string>();

  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 0) {
        visit(next);
      } else if (nextState === 1) {
        const startIndex = stack.indexOf(next);
        const cycle = startIndex >= 0 ? stack.slice(startIndex) : [next];
        const canonical = [...cycle].sort().join("\u0000");
        if (!seenCycles.has(canonical)) {
          seenCycles.add(canonical);
          cycles.push([...cycle, next]);
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of [...edges.keys()].sort()) {
    if ((state.get(node) ?? 0) === 0) {
      visit(node);
    }
  }
  return cycles;
}
