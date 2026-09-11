import { matchesCodePathPattern } from "../lib/search.js";
import { loadKnowledgeForRead } from "../lib/knowledge/read.js";
import type { KnowledgeDocument, KnowledgeKind } from "../lib/knowledge/document.js";
import { relationsFor } from "../lib/knowledge/knowledge-model.js";
import type { DocumentStatus } from "../lib/knowledge/validity.js";
import {
  knowledgeReadEnvelope,
  knowledgeReadInput,
  normalizeSourceFile,
  type KnowledgeReadOptions
} from "../lib/knowledge/read-view.js";

export async function runContext(files: string[], options: KnowledgeReadOptions): Promise<unknown> {
  const loaded = await loadKnowledgeForRead(knowledgeReadInput(options));
  const normalizedFiles = files.map((file) => normalizeSourceFile(file));
  const impacted: Array<{ id: string; document: KnowledgeDocument; matchedPaths: string[]; status: DocumentStatus }> = [];
  const matched = new Set<string>();
  for (const file of normalizedFiles) {
    for (const document of loaded.model.documents) {
      const matchedPaths = document.frontmatter.source.paths.filter((pattern) => matchesCodePathPattern(pattern, file));
      if (matchedPaths.length === 0) {
        continue;
      }
      matched.add(document.id);
      const existing = impacted.find((entry) => entry.id === document.id);
      if (existing) {
        existing.matchedPaths.push(...matchedPaths.filter((path) => !existing.matchedPaths.includes(path)));
      } else {
        impacted.push({
          id: document.id,
          document,
          matchedPaths,
          status: loaded.validity.byId.get(document.id)?.status ?? "unverified"
        });
      }
    }
  }
  const prerequisites: Array<{ id: string; kind: KnowledgeKind; status: DocumentStatus }> = [];
  const seenPrerequisites = new Set<string>();
  const collect = (document: KnowledgeDocument): void => {
    for (const requirement of relationsFor(loaded.model, document.id).requires) {
      if (seenPrerequisites.has(requirement)) {
        continue;
      }
      const target = loaded.model.byId.get(requirement);
      if (!target) {
        continue;
      }
      seenPrerequisites.add(requirement);
      prerequisites.push({
        id: target.id,
        kind: target.frontmatter.kind,
        status: loaded.validity.byId.get(target.id)?.status ?? "unverified"
      });
      collect(target);
    }
  };
  for (const entry of impacted) {
    collect(entry.document);
  }
  return {
    schema: "llmdoc.context/v1",
    ...knowledgeReadEnvelope(loaded),
    impacted: impacted
      .map((entry) => ({
        id: entry.id,
        kind: entry.document.frontmatter.kind,
        status: entry.status,
        matchedPaths: [...new Set(entry.matchedPaths)].sort()
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    prerequisites: prerequisites.sort((left, right) => left.id.localeCompare(right.id)),
    unmappedFiles: normalizedFiles.filter((file) =>
      !loaded.model.documents.some((document) =>
        document.frontmatter.source.paths.some((pattern) => matchesCodePathPattern(pattern, file))
      )
    ),
    matchedDocumentCount: matched.size
  };
}
