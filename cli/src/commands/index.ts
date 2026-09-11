import { paginate, paginationMetadata } from "../lib/pagination.js";
import { loadKnowledgeForRead } from "../lib/knowledge/read.js";
import {
  assertKnowledgeKind,
  knowledgeDocumentSummary,
  knowledgeReadEnvelope,
  knowledgeReadInput,
  type KnowledgeReadOptions
} from "../lib/knowledge/read-view.js";

export async function runIndex(options: KnowledgeReadOptions): Promise<unknown> {
  const loaded = await loadKnowledgeForRead(knowledgeReadInput(options));
  const kind = assertKnowledgeKind(options.kind);
  const documents = loaded.model.documents.filter((document) => {
    if (options.topic && document.topic !== options.topic) {
      return false;
    }
    if (kind && document.frontmatter.kind !== kind) {
      return false;
    }
    return true;
  });
  const page = paginate({
    items: documents,
    estimate: (document) => document.estimatedTokens,
    options
  });
  return {
    schema: "llmdoc.index/v1",
    ...knowledgeReadEnvelope(loaded),
    documents: page.items.map((document) => knowledgeDocumentSummary(loaded, document)),
    pagination: paginationMetadata(page)
  };
}
