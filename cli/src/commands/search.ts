import { paginate, paginationMetadata } from "../lib/pagination.js";
import { loadKnowledgeForRead } from "../lib/knowledge/read.js";
import { searchKnowledge } from "../lib/knowledge/search.js";
import {
  assertKnowledgeKind,
  knowledgeReadEnvelope,
  knowledgeReadInput,
  type KnowledgeReadOptions
} from "../lib/knowledge/read-view.js";

export async function runSearch(query: string, options: KnowledgeReadOptions): Promise<unknown> {
  const loaded = await loadKnowledgeForRead(knowledgeReadInput(options));
  const kind = assertKnowledgeKind(options.kind);
  const response = searchKnowledge({ model: loaded.model, validity: loaded.validity, query, topic: options.topic, kind });
  const page = paginate({
    items: response.results,
    estimate: (entry) => Math.max(1, Math.ceil(JSON.stringify(entry).length / 4)),
    options
  });
  return {
    schema: "llmdoc.search/v1",
    ...knowledgeReadEnvelope(loaded),
    query,
    searchMode: response.mode,
    results: page.items,
    pagination: paginationMetadata(page)
  };
}
