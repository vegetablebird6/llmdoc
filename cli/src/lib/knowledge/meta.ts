import fs from "node:fs";
import path from "node:path";

import { KnowledgeError } from "./errors.js";
import { REPOSITORY_ID_PATTERN } from "./identity.js";
import type { KnowledgeIssue } from "./knowledge-model.js";

export const KNOWLEDGE_META_SCHEMA = "llmdoc.meta/v3-ng";

export interface ValidatedEvidence {
  validatedSourceRevision: string | null;
  validatedContentDigest: string | null;
  validatedSourcePaths: string[];
  validatedRequires: Record<string, string>;
}

export interface KnowledgeMeta {
  schema: typeof KNOWLEDGE_META_SCHEMA;
  source: {
    repositoryId: string;
    lastGlobalReviewRevision: string | null;
  };
  documents: Record<string, ValidatedEvidence>;
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function readKnowledgeMeta(metaPath: string): { meta: KnowledgeMeta | null; issues: KnowledgeIssue[] } {
  if (!fs.existsSync(metaPath)) {
    return {
      meta: null,
      issues: [
        {
          severity: "error",
          code: "meta.missing",
          path: metaPath,
          message: "The knowledge repository has no .llmdoc/meta.json validation ledger."
        }
      ]
    };
  }
  return parseKnowledgeMeta(fs.readFileSync(metaPath, "utf8"), metaPath);
}

/** Parses the ledger from raw content so callers can read it from a fixed Knowledge revision. */
export function parseKnowledgeMeta(raw: string, label: string): { meta: KnowledgeMeta | null; issues: KnowledgeIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      meta: null,
      issues: [{ severity: "error", code: "meta.parse", path: label, message: `meta.json parse failed: ${(error as Error).message}` }]
    };
  }
  try {
    return { meta: validateKnowledgeMeta(parsed, label), issues: [] };
  } catch (error) {
    if (error instanceof KnowledgeError) {
      return { meta: null, issues: [{ severity: "error", code: "meta.invalid", path: label, message: error.message }] };
    }
    throw error;
  }
}

export function validateKnowledgeMeta(parsed: unknown, label: string): KnowledgeMeta {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new KnowledgeError("E_META_INVALID", "meta.json must contain a mapping", { paths: [label] });
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== KNOWLEDGE_META_SCHEMA) {
    throw new KnowledgeError("E_META_INVALID", `meta.json schema must be ${KNOWLEDGE_META_SCHEMA}`, { paths: [label] });
  }
  const source = record.source;
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new KnowledgeError("E_META_INVALID", "meta.json source must be a mapping", { paths: [label] });
  }
  const sourceRecord = source as Record<string, unknown>;
  if (!REPOSITORY_ID_PATTERN.test(String(sourceRecord.repositoryId ?? ""))) {
    throw new KnowledgeError("E_META_INVALID", "meta.json source.repositoryId must be llmdoc-<32 hex>", { paths: [label] });
  }
  const lastGlobal = sourceRecord.lastGlobalReviewRevision;
  if (lastGlobal !== null && (typeof lastGlobal !== "string" || !FULL_OID_PATTERN.test(lastGlobal))) {
    throw new KnowledgeError("E_META_INVALID", "meta.json source.lastGlobalReviewRevision must be a full commit OID or null", {
      paths: [label]
    });
  }
  if (record.documents === null || typeof record.documents !== "object" || Array.isArray(record.documents)) {
    throw new KnowledgeError("E_META_INVALID", "meta.json documents must be a mapping", { paths: [label] });
  }
  const documents: Record<string, ValidatedEvidence> = {};
  for (const [id, evidence] of Object.entries(record.documents as Record<string, unknown>)) {
    if (!isCanonicalDocumentId(id)) {
      throw new KnowledgeError("E_META_INVALID", `meta.json document id must be a canonical docs-relative .md path: ${id}`, {
        paths: [label]
      });
    }
    documents[id] = validateEvidence(id, evidence, label);
  }
  return {
    schema: KNOWLEDGE_META_SCHEMA,
    source: {
      repositoryId: String(sourceRecord.repositoryId),
      lastGlobalReviewRevision: (lastGlobal as string | null) ?? null
    },
    documents
  };
}

function validateEvidence(id: string, input: unknown, label: string): ValidatedEvidence {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new KnowledgeError("E_META_INVALID", `meta.json documents["${id}"] must be a mapping`, { paths: [label] });
  }
  const record = input as Record<string, unknown>;
  const revision = record.validatedSourceRevision;
  if (revision !== null && (typeof revision !== "string" || !FULL_OID_PATTERN.test(revision))) {
    throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedSourceRevision must be a full commit OID or null`, {
      paths: [label]
    });
  }
  const digest = record.validatedContentDigest;
  if (digest !== null && (typeof digest !== "string" || !DIGEST_PATTERN.test(digest))) {
    throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedContentDigest must be sha256:<64 hex> or null`, {
      paths: [label]
    });
  }
  const paths = record.validatedSourcePaths;
  if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== "string")) {
    throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedSourcePaths must be a list of strings`, { paths: [label] });
  }
  const sourcePaths = paths as string[];
  for (const sourcePath of sourcePaths) {
    if (!isCanonicalSourcePath(sourcePath)) {
      throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedSourcePaths has an invalid path: ${sourcePath}`, {
        paths: [label]
      });
    }
  }
  if (!isSortedUnique(sourcePaths)) {
    throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedSourcePaths must be normalized, de-duplicated and sorted`, {
      paths: [label]
    });
  }
  const requires = record.validatedRequires;
  if (requires === null || typeof requires !== "object" || Array.isArray(requires)) {
    throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedRequires must be a mapping`, { paths: [label] });
  }
  const validatedRequires: Record<string, string> = {};
  for (const [target, value] of Object.entries(requires as Record<string, unknown>)) {
    if (!isCanonicalDocumentId(target)) {
      throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedRequires key must be a canonical docs-relative .md path: ${target}`, {
        paths: [label]
      });
    }
    if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
      throw new KnowledgeError("E_META_INVALID", `meta.json ${id}.validatedRequires["${target}"] must be sha256:<64 hex>`, {
        paths: [label]
      });
    }
    validatedRequires[target] = value;
  }

  const hasDigest = digest !== null && digest !== undefined;
  const hasRevision = revision !== null && revision !== undefined;
  // Four validation evidence are written together: either the whole tuple is unverified
  // (null/null/[]/{}) or it is complete (full OID / sha256 / non-empty normalized paths).
  if (!hasDigest) {
    if (hasRevision || sourcePaths.length > 0 || Object.keys(validatedRequires).length > 0) {
      throw new KnowledgeError("E_META_INVALID", `meta.json ${id} is unverified but carries partial validation evidence`, {
        paths: [label]
      });
    }
  } else {
    if (!hasRevision) {
      throw new KnowledgeError("E_META_INVALID", `meta.json ${id} has a content digest but no validated source revision`, {
        paths: [label]
      });
    }
    if (sourcePaths.length === 0) {
      throw new KnowledgeError("E_META_INVALID", `meta.json ${id} has a content digest but an empty validated source scope`, {
        paths: [label]
      });
    }
  }

  return {
    validatedSourceRevision: (revision as string | null) ?? null,
    validatedContentDigest: (digest as string | null) ?? null,
    validatedSourcePaths: [...sourcePaths],
    validatedRequires
  };
}

function isCanonicalDocumentId(id: string): boolean {
  if (id.length === 0 || !id.endsWith(".md") || id.includes("\\") || id.startsWith("/")) {
    return false;
  }
  if (id.startsWith("./") || /^[A-Za-z]:/.test(id)) {
    return false;
  }
  const normalized = path.posix.normalize(id);
  return normalized === id && !normalized.split("/").includes("..") && normalized !== ".";
}

function isCanonicalSourcePath(sourcePath: string): boolean {
  if (sourcePath.length === 0 || sourcePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(sourcePath)) {
    return false;
  }
  const segments = sourcePath.replaceAll("\\", "/").split("/");
  return !segments.includes("..") && !segments.includes("");
}

function isSortedUnique(values: string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      return false;
    }
  }
  return true;
}
