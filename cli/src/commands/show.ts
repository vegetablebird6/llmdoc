import { KnowledgeError } from "../lib/knowledge/errors.js";
import { loadKnowledgeForRead } from "../lib/knowledge/read.js";
import type { KnowledgeDocument } from "../lib/knowledge/document.js";
import { relationsFor, type CanonicalRelations } from "../lib/knowledge/knowledge-model.js";
import {
  knowledgeDocumentSummary,
  knowledgeReadEnvelope,
  knowledgeReadInput,
  normalizeDocumentId,
  type KnowledgeReadOptions
} from "../lib/knowledge/read-view.js";

function canonicalFrontmatter(document: KnowledgeDocument, relations: CanonicalRelations): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = { ...document.frontmatter };
  const declared: Record<string, string[]> = {};
  if (relations.requires.length > 0) {
    declared.requires = relations.requires;
  }
  if (relations.related.length > 0) {
    declared.related = relations.related;
  }
  if (relations.supersedes.length > 0) {
    declared.supersedes = relations.supersedes;
  }
  if (Object.keys(declared).length > 0) {
    frontmatter.relations = declared;
  } else {
    delete frontmatter.relations;
  }
  return frontmatter;
}

export async function runShow(paths: string[], options: KnowledgeReadOptions): Promise<unknown> {
  const loaded = await loadKnowledgeForRead(knowledgeReadInput(options));
  const documents: Array<Record<string, unknown>> = [];
  for (const rawPath of paths) {
    const id = normalizeDocumentId(rawPath);
    const document = loaded.model.byId.get(id);
    if (!document) {
      throw new KnowledgeError("E_KNOWLEDGE_DOC_NOT_FOUND", `Document does not exist: ${rawPath}`, { paths: [rawPath] });
    }
    const validity = loaded.validity.byId.get(id);
    documents.push({
      ...knowledgeDocumentSummary(loaded, document),
      status: validity?.status ?? "unverified",
      frontmatter: canonicalFrontmatter(document, relationsFor(loaded.model, id)),
      body: document.body
    });
  }
  return {
    schema: "llmdoc.show/v1",
    ...knowledgeReadEnvelope(loaded),
    documents,
    pagination: {
      totalItems: documents.length,
      returnedItems: documents.length,
      totalEstimatedTokens: documents.reduce((sum, entry) => sum + Math.ceil(JSON.stringify(entry).length / 4), 0),
      returnedEstimatedTokens: documents.reduce((sum, entry) => sum + Math.ceil(JSON.stringify(entry).length / 4), 0),
      nextCursor: null
    }
  };
}
