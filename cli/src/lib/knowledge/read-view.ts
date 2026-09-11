import type { OutputOptions } from "../../types.js";
import { KnowledgeError } from "./errors.js";
import { KNOWLEDGE_KINDS, isKnowledgeKind, type KnowledgeDocument, type KnowledgeKind } from "./document.js";
import { relationsFor, type KnowledgeIssue } from "./knowledge-model.js";
import type { LoadedKnowledge, LoadKnowledgeForReadInput, ReadMode } from "./read.js";
import type { SourceBlocker } from "./contexts.js";
import type { DocumentStatus } from "./validity.js";

export interface KnowledgeReadOptions extends OutputOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  topic?: string;
  kind?: string;
}

export function knowledgeReadInput(options: KnowledgeReadOptions): LoadKnowledgeForReadInput {
  return { cwd: options.cwd, sourceInput: options.source, knowledgeInput: options.knowledge };
}

export interface KnowledgeReadEnvelope {
  mode: ReadMode;
  repositoryId: string | null;
  sourceRevision: string | null;
  knowledgeRevision: string | null;
  lastGlobalReviewRevision: string | null;
  unbound: boolean;
  sourceBlockers: SourceBlocker[];
  historyAvailable: boolean;
  issues: KnowledgeIssue[];
}

export function knowledgeReadEnvelope(loaded: LoadedKnowledge): KnowledgeReadEnvelope {
  return {
    mode: loaded.mode,
    repositoryId: loaded.repositoryId,
    sourceRevision: loaded.validity.sourceRevision,
    knowledgeRevision: loaded.knowledgeRevision,
    lastGlobalReviewRevision: loaded.validity.lastGlobalReviewRevision,
    unbound: loaded.mode === "unbound",
    sourceBlockers: loaded.validity.sourceBlockers.map((blocker) => ({ ...blocker, paths: [...blocker.paths] })),
    historyAvailable: loaded.validity.historyAvailable,
    issues: loaded.issues.map((issue) => ({ ...issue }))
  };
}

export function knowledgeDocumentSummary(loaded: LoadedKnowledge, document: KnowledgeDocument): Record<string, unknown> {
  const validity = loaded.validity.byId.get(document.id);
  return {
    id: document.id,
    kind: document.frontmatter.kind,
    title: document.title,
    description: document.frontmatter.description,
    topic: document.topic,
    status: validity?.status ?? "unverified",
    reasons: validity?.reasons ?? [],
    sourcePaths: [...document.frontmatter.source.paths],
    requires: [...relationsFor(loaded.model, document.id).requires],
    supersededBy: loaded.model.supersededBy.get(document.id) ?? []
  };
}

export function assertKnowledgeKind(kind: string | undefined): KnowledgeKind | undefined {
  if (kind === undefined) {
    return undefined;
  }
  if (isKnowledgeKind(kind)) {
    return kind;
  }
  throw new KnowledgeError("E_INVALID_KIND", `Invalid kind: ${kind}. Allowed values: ${KNOWLEDGE_KINDS.join(", ")}`, {
    paths: [kind]
  });
}

export function normalizeDocumentId(input: string): string {
  const withoutPrefix = input.startsWith("docs/") ? input.slice("docs/".length) : input;
  return withoutPrefix.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function normalizeSourceFile(input: string): string {
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("../") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new KnowledgeError("E_INVALID_SOURCE_FILE", `Files must be normalized repository-relative paths: ${input}`, {
      paths: [input]
    });
  }
  return normalized;
}

export type { DocumentStatus };
