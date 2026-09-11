import { buildSnippet, cjkBigrams, countSubstring, countWords, tokenizeQuery } from "../search.js";
import type { KnowledgeKind, KnowledgeDocument } from "./document.js";
import { relationsFor, type KnowledgeModel } from "./knowledge-model.js";
import type { DocumentStatus, ValidityProjection } from "./validity.js";

export type KnowledgeSearchMode = "lexical" | "cjk-bigram-fallback";

export interface KnowledgeSearchResult {
  id: string;
  kind: KnowledgeKind;
  title: string | null;
  description: string;
  status: DocumentStatus;
  reasons: string[];
  supersededBy: string[];
  supersedes: string[];
  score: number;
  snippet: string;
}

export interface KnowledgeSearchResponse {
  results: KnowledgeSearchResult[];
  mode: KnowledgeSearchMode;
}

export interface SearchKnowledgeInput {
  model: KnowledgeModel;
  validity: ValidityProjection;
  query: string;
  topic?: string;
  kind?: KnowledgeKind;
}

interface Token {
  value: string;
  weight: number;
}

export function searchKnowledge(input: SearchKnowledgeInput): KnowledgeSearchResponse {
  const { model, validity, query } = input;
  const normalizedQuery = query.trim().toLowerCase();
  const documents = model.documents.filter((document) => {
    if (input.topic && document.topic !== input.topic) {
      return false;
    }
    if (input.kind && document.frontmatter.kind !== input.kind) {
      return false;
    }
    return true;
  });
  const searchable = new Map(documents.map((document) => [document.id, searchableText(document)]));

  const lexicalTokens: Token[] = tokenizeQuery(query).map((value) => ({ value, weight: 1 }));
  const lexical = scoreDocuments(model, documents, searchable, validity, lexicalTokens, {
    minimumMatchedTokens: 1,
    normalizedQuery
  });
  if (lexical.length > 0) {
    return { results: lexical, mode: "lexical" };
  }

  const bigrams = cjkBigrams(query);
  if (bigrams.length === 0) {
    return { results: [], mode: "lexical" };
  }
  const minimumMatchedTokens = bigrams.length >= 4 ? Math.max(2, Math.ceil(bigrams.length * 0.25)) : 1;
  return {
    results: scoreDocuments(
      model,
      documents,
      searchable,
      validity,
      bigrams.map((value) => ({ value, weight: 0.55 })),
      { minimumMatchedTokens, normalizedQuery }
    ),
    mode: "cjk-bigram-fallback"
  };
}

function scoreDocuments(
  model: KnowledgeModel,
  documents: KnowledgeDocument[],
  searchable: Map<string, string>,
  validity: ValidityProjection,
  tokens: Token[],
  options: { minimumMatchedTokens: number; normalizedQuery: string }
): KnowledgeSearchResult[] {
  if (tokens.length === 0) {
    return [];
  }
  const documentFrequency = new Map<string, number>();
  for (const token of tokens) {
    let count = 0;
    for (const document of documents) {
      if (searchable.get(document.id)!.includes(token.value)) {
        count += 1;
      }
    }
    documentFrequency.set(token.value, count);
  }

  return documents
    .map((document) => {
      const text = searchable.get(document.id)!;
      const wordCount = countWords(text);
      let score = 0;
      let matchedTokenCount = 0;
      for (const token of tokens) {
        const frequency = countSubstring(text, token.value);
        if (frequency === 0) {
          continue;
        }
        matchedTokenCount += 1;
        const df = documentFrequency.get(token.value) ?? 0;
        const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
        score += token.weight * idf * ((frequency * 2.2) / (frequency + 1.2 * (1 - 0.75 + 0.75 * (wordCount / 200))));
      }
      if (options.normalizedQuery.length > 1) {
        score += countSubstring(text, options.normalizedQuery) * (tokens.length + 1) * 2;
      }
      const validityEntry = validity.byId.get(document.id);
      const result: KnowledgeSearchResult = {
        id: document.id,
        kind: document.frontmatter.kind,
        title: document.title,
        description: document.frontmatter.description,
        status: validityEntry?.status ?? "unverified",
        reasons: validityEntry?.reasons ?? [],
        supersededBy: model.supersededBy.get(document.id) ?? [],
        supersedes: relationsFor(model, document.id).supersedes,
        score,
        snippet: buildSnippet(document.body, tokens.map((token) => token.value))
      };
      return { result, matchedTokenCount };
    })
    .filter((entry) => entry.result.score > 0 && entry.matchedTokenCount >= options.minimumMatchedTokens)
    .sort((left, right) => {
      if (right.result.score !== left.result.score) {
        return right.result.score - left.result.score;
      }
      const supersededRank = (entry: { result: KnowledgeSearchResult }): number =>
        entry.result.supersededBy.length > 0 ? 1 : 0;
      return supersededRank(left) - supersededRank(right) || left.result.id.localeCompare(right.result.id);
    })
    .map((entry) => entry.result);
}

function searchableText(document: KnowledgeDocument): string {
  return [document.frontmatter.description, document.title ?? "", document.body].join("\n").toLowerCase();
}
