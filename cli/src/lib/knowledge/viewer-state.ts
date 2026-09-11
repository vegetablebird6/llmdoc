import path from "node:path";

import { resolveDocLink } from "../markdown.js";
import type { KnowledgeKind } from "./document.js";
import type { KnowledgeIssue } from "./knowledge-model.js";
import type { LoadedKnowledge } from "./read.js";
import type { DocumentStatus } from "./validity.js";
import type { SourceBlocker } from "./contexts.js";

export type KnowledgeViewerEdgeType = "requires" | "related" | "link" | "supersedes";

export interface KnowledgeViewerNodeDto {
  id: string;
  topic: string | null;
  title: string | null;
  kind: KnowledgeKind;
  description: string;
  estimatedTokens: number;
  lineCount: number;
  sourcePaths: string[];
  status: DocumentStatus;
  reasons: string[];
  supersededBy: string[];
}

export interface KnowledgeViewerEdgeDto {
  from: string;
  to: string;
  type: KnowledgeViewerEdgeType;
}

export interface KnowledgeViewerStateDto {
  repository: string;
  mode: string;
  repositoryId: string | null;
  sourceRevision: string | null;
  knowledgeRevision: string | null;
  lastGlobalReviewRevision: string | null;
  sourceBlockers: SourceBlocker[];
  historyAvailable: boolean;
  nodes: KnowledgeViewerNodeDto[];
  edges: KnowledgeViewerEdgeDto[];
  issues: KnowledgeIssue[];
}

const EDGE_PRIORITY: Readonly<Record<KnowledgeViewerEdgeType, number>> = {
  requires: 4,
  supersedes: 3,
  related: 2,
  link: 1
};

/**
 * Projects the same knowledge model and validity used by the read commands. It does not
 * read files or Git and does not introduce a second validity rule set.
 */
export function projectKnowledgeViewerState(loaded: LoadedKnowledge): KnowledgeViewerStateDto {
  const nodes = loaded.model.documents
    .map((document): KnowledgeViewerNodeDto => {
      const validity = loaded.validity.byId.get(document.id);
      return {
        id: document.id,
        topic: document.topic,
        title: document.title,
        kind: document.frontmatter.kind,
        description: document.frontmatter.description,
        estimatedTokens: document.estimatedTokens,
        lineCount: document.lineCount,
        sourcePaths: [...document.frontmatter.source.paths],
        status: validity?.status ?? "unverified",
        reasons: validity?.reasons ?? [],
        supersededBy: loaded.model.supersededBy.get(document.id) ?? []
      };
    })
    .sort((left, right) => compareText(left.id, right.id));

  const edgesByDirection = new Map<string, KnowledgeViewerEdgeDto>();
  const addEdge = (from: string, to: string, type: KnowledgeViewerEdgeType): void => {
    if (from === to || !loaded.model.byId.has(to)) {
      return;
    }
    const key = `${from}\u0000${to}`;
    const current = edgesByDirection.get(key);
    if (!current || EDGE_PRIORITY[type] > EDGE_PRIORITY[current.type]) {
      edgesByDirection.set(key, { from, to, type });
    }
  };
  for (const [from, relation] of loaded.model.relations) {
    for (const target of relation.requires) {
      addEdge(from, target, "requires");
    }
    for (const target of relation.related) {
      addEdge(from, target, "related");
    }
    for (const target of relation.supersedes) {
      addEdge(from, target, "supersedes");
    }
  }
  for (const document of loaded.model.documents) {
    for (const link of document.links) {
      addEdge(document.id, resolveDocLink(document.id, link), "link");
    }
  }

  return {
    repository: path.basename(loaded.knowledgeRoot),
    mode: loaded.mode,
    repositoryId: loaded.repositoryId,
    sourceRevision: loaded.validity.sourceRevision,
    knowledgeRevision: loaded.knowledgeRevision,
    lastGlobalReviewRevision: loaded.validity.lastGlobalReviewRevision,
    sourceBlockers: loaded.validity.sourceBlockers.map((blocker) => ({ ...blocker })),
    historyAvailable: loaded.validity.historyAvailable,
    nodes,
    edges: [...edgesByDirection.values()].sort(
      (left, right) =>
        compareText(left.from, right.from) || compareText(left.to, right.to) || EDGE_PRIORITY[right.type] - EDGE_PRIORITY[left.type]
    ),
    issues: loaded.issues.map((issue) => ({ ...issue }))
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
