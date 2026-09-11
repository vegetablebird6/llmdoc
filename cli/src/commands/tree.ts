import { paginate, paginationMetadata } from "../lib/pagination.js";
import { loadKnowledgeForRead } from "../lib/knowledge/read.js";
import {
  knowledgeDocumentSummary,
  knowledgeReadEnvelope,
  knowledgeReadInput,
  type KnowledgeReadOptions
} from "../lib/knowledge/read-view.js";

export async function runTree(options: KnowledgeReadOptions): Promise<unknown> {
  const loaded = await loadKnowledgeForRead(knowledgeReadInput(options));
  const page = paginate({
    items: loaded.model.documents,
    estimate: (document) => document.estimatedTokens,
    options
  });
  const topics = new Map<string, Array<Record<string, unknown>>>();
  const rootSingletons: Array<Record<string, unknown>> = [];
  for (const document of page.items) {
    const summary = knowledgeDocumentSummary(loaded, document);
    if (document.topic) {
      const bucket = topics.get(document.topic) ?? [];
      bucket.push(summary);
      topics.set(document.topic, bucket);
    } else {
      rootSingletons.push(summary);
    }
  }
  return {
    schema: "llmdoc.tree/v1",
    ...knowledgeReadEnvelope(loaded),
    topics: [...topics.entries()]
      .map(([topic, documents]) => ({ topic, documents }))
      .sort((left, right) => left.topic.localeCompare(right.topic)),
    rootSingletons,
    pagination: paginationMetadata(page)
  };
}
