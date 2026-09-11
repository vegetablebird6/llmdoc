import { describe, expect, test } from "vitest";

import { buildKnowledgeModelFromRaw, type KnowledgeRawEntry } from "../src/lib/knowledge/knowledge-model.js";
import { searchKnowledge } from "../src/lib/knowledge/search.js";
import type { ValidityProjection } from "../src/lib/knowledge/validity.js";

function modelFor(files: Record<string, string>) {
  const entries: KnowledgeRawEntry[] = Object.entries(files).map(([id, raw]) => ({
    id,
    raw,
    absolutePath: `/virtual/docs/${id}`
  }));
  return buildKnowledgeModelFromRaw(entries, "/virtual/docs");
}

function frontmatter(description: string, kind = "reference"): string {
  return `---\ndescription: ${description}\nkind: ${kind}\nsource:\n  paths:\n    - src/api/retry.ts\n---\n\n`;
}

const noValidity: ValidityProjection = {
  byId: new Map(),
  sourceRevision: null,
  lastGlobalReviewRevision: null,
  sourceBlockers: [],
  historyAvailable: false,
  issues: []
};

function search(model: ReturnType<typeof modelFor>, query: string) {
  return searchKnowledge({ model, validity: noValidity, query });
}

describe("CJK search", () => {
  test("segments natural Chinese queries without requiring manual spaces", () => {
    const model = modelFor({
      "mock-world/traffic-control.md": `${frontmatter("终端流量按权重分摊，限速由令牌桶生效。", "guide")}# 流量控制\n\n终端流量按权重分摊。系统通过令牌桶实施限速，配置保存后立即生效。\n`
    });

    const natural = search(model, "限速是怎么生效的");
    expect(natural.mode).toBe("lexical");
    expect(natural.results[0]?.id).toBe("mock-world/traffic-control.md");

    const concept = search(model, "终端速率分摊");
    expect(concept.mode).toBe("lexical");
    expect(concept.results[0]?.id).toBe("mock-world/traffic-control.md");
  });

  test("prefers exact phrases over partial lexical matches", () => {
    const model = modelFor({
      "ranking/exact.md": `${frontmatter("终端速率分摊的精确说明。")}# 精确命中\n\n终端速率分摊。\n`,
      "ranking/partial.md": `${frontmatter("终端流量的分摊说明。")}# 部分命中\n\n终端流量按权重分摊。\n`
    });

    const payload = search(model, "终端速率分摊");
    expect(payload.results[0]?.id).toBe("ranking/exact.md");
    expect(payload.results[0]!.score).toBeGreaterThan(payload.results[1]!.score);
  });

  test("uses an annotated bigram fallback when lexical terms have no hits", () => {
    const model = modelFor({
      "devices/throughput.md": `${frontmatter("吞吐限制的配置规则。")}# 吞吐限制\n\n系统通过配额设置吞吐限制。\n`
    });

    const fallback = search(model, "吞吐量");
    expect(fallback.mode).toBe("cjk-bigram-fallback");
    expect(fallback.results[0]?.id).toBe("devices/throughput.md");

    const noisy = search(model, "吞吐量完全未知");
    expect(noisy.mode).toBe("cjk-bigram-fallback");
    expect(noisy.results).toEqual([]);
  });

  test("keeps existing single-term Chinese and Latin search behavior", () => {
    const model = modelFor({
      "api-client/retry-policy.md": `${frontmatter("请求重试的适用条件。", "guide")}# 请求重试策略\n\nretry policy\n`
    });

    const chinese = search(model, "重试");
    expect(chinese.mode).toBe("lexical");
    expect(chinese.results.some((entry) => entry.id === "api-client/retry-policy.md")).toBe(true);

    const latin = search(model, "retry");
    expect(latin.mode).toBe("lexical");
    expect(latin.results.some((entry) => entry.id === "api-client/retry-policy.md")).toBe(true);
  });
});
