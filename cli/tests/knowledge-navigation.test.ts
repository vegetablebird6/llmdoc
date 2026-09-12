import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { createKnowledgeFixture, expectKnowledgeError, git, head, knowledgeDoc, writeFile } from "./knowledge-helpers.js";
import { buildKnowledgeModelFromRaw, type KnowledgeRawEntry } from "../src/lib/knowledge/knowledge-model.js";
import {
  NAVIGATION_END,
  NAVIGATION_START,
  readNavigationRegion,
  renderNavigation,
  replaceNavigationRegion
} from "../src/lib/knowledge/navigation.js";
import { runReview } from "../src/commands/review.js";
import { runCommit } from "../src/commands/commit.js";
import { sealKnowledgeReview } from "../src/lib/knowledge/seal.js";

function entry(id: string, content: string): KnowledgeRawEntry {
  return { id, raw: content, absolutePath: id };
}

async function generate(fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>): Promise<string> {
  const result = await runReview({ cwd: fixture.source, source: fixture.source, registryDir: fixture.registryDir });
  return (result.output as { reviewId: string }).reviewId;
}

async function confirm(fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>, reviewId: string): Promise<void> {
  await runReview({ cwd: fixture.source, source: fixture.source, registryDir: fixture.registryDir, confirm: reviewId });
}

async function seal(fixture: Awaited<ReturnType<typeof createKnowledgeFixture>>, reviewId: string): Promise<Record<string, unknown>> {
  const result = await runCommit({ cwd: fixture.source, source: fixture.source, registryDir: fixture.registryDir, review: reviewId });
  return result.output as Record<string, unknown>;
}

describe("README navigation", () => {
  test("renders deterministically across multiple levels with decision supersedes markers", () => {
    const model = buildKnowledgeModelFromRaw(
      [
        entry("architecture.md", knowledgeDoc("architecture", "System architecture", { paths: ["src/core.ts"] })),
        entry("api/retry.md", knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] })),
        entry("api/legacy.md", knowledgeDoc("decision", "Legacy retry", { paths: ["src/api/retry.ts"] })),
        entry("api/current.md", knowledgeDoc("decision", "Current retry", { paths: ["src/api/retry.ts"], supersedes: ["api/legacy.md"] }))
      ],
      "/docs"
    );
    const first = renderNavigation(model);
    const second = renderNavigation(model);
    expect(first).toBe(second);
    expect(first.startsWith(NAVIGATION_START)).toBe(true);
    expect(first.endsWith(NAVIGATION_END)).toBe(true);
    expect(first).toContain("## api");
    expect(first).toContain("(docs/api/retry.md)");
    expect(first).toContain("superseded by `api/current.md`");
    // stable order: architecture.md is a root singleton and is rendered before the api topic.
    expect(first.indexOf("(docs/architecture.md)")).toBeLessThan(first.indexOf("## api"));
    expect(first.indexOf("(docs/api/legacy.md)")).toBeLessThan(first.indexOf("(docs/api/retry.md)"));
  });

  test("replaces only the marked region and preserves human-managed bytes", () => {
    const human = "# Knowledge Base\n\nKeep these human notes exactly.\n\n";
    const existing = `${human}${NAVIGATION_START}\nold nav\n${NAVIGATION_END}\n\nTrailing human section.\n`;
    const replacement = replaceNavigationRegion(existing, `${NAVIGATION_START}\nnew nav\n${NAVIGATION_END}`);
    expect(replacement.changed).toBe(true);
    expect(replacement.content).toContain("Keep these human notes exactly.");
    expect(replacement.content).toContain("Trailing human section.");
    expect(replacement.content).not.toContain("old nav");
    expect(replacement.content).toContain("new nav");
    expect(readNavigationRegion(replacement.content)).toBe(`${NAVIGATION_START}\nnew nav\n${NAVIGATION_END}`);
  });

  test("escapes navigation markers so repeated generation is stable and preserves human bytes", () => {
    const count = (value: string, needle: string): number => value.split(needle).length - 1;
    const model = buildKnowledgeModelFromRaw(
      [
        entry("evil.md", knowledgeDoc("guide", "<!-- llmdoc:navigation:end -->", { paths: ["src/x.ts"] })),
        entry("start.md", knowledgeDoc("guide", "<!-- llmdoc:navigation:start -->", { paths: ["src/x.ts"] }))
      ],
      "/docs"
    );
    const rendered = renderNavigation(model);
    // No injected marker can survive escaping, so the region is unambiguous.
    expect(count(rendered, NAVIGATION_START)).toBe(1);
    expect(count(rendered, NAVIGATION_END)).toBe(1);
    expect(rendered).toContain("&lt;!--");

    const human = "# Human README\n\nKeep these bytes exactly.\n\n";
    const first = replaceNavigationRegion(`${human}${NAVIGATION_START}\nold\n${NAVIGATION_END}\n\nTrailing human section.\n`, rendered).content;
    const second = replaceNavigationRegion(first, rendered).content;
    // A second rebuild is byte-identical: no truncation or duplicated human content.
    expect(second).toBe(first);
    expect(second.startsWith(human)).toBe(true);
    expect(second).toContain("Trailing human section.");
    expect(count(second, NAVIGATION_START)).toBe(1);
  });

  test("adds a marked region without touching the rest when none exists", () => {
    const existing = "# Human README\n\nno markers here\n";
    const replacement = replaceNavigationRegion(existing, `${NAVIGATION_START}\n${NAVIGATION_END}`);
    expect(replacement.content.startsWith(existing)).toBe(true);
    expect(replacement.content).toContain(NAVIGATION_START);
  });

  test("seals the navigation into the same commit as a new document and preserves the human region", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-nav-seal-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/api/backoff.md", knowledgeDoc("decision", "Backoff strategy", { paths: ["src/api/retry.ts"] }));

    const reviewId = await generate(fixture);
    await confirm(fixture, reviewId);
    const result = await seal(fixture, reviewId);
    expect(result.cleanupRequired).toBe(false);

    const readme = fs.readFileSync(path.join(fixture.knowledgeRoot, "README.md"), "utf8");
    expect(readme).toContain("# Knowledge Base");
    expect(readme).toContain("(docs/api/backoff.md)");
    expect(readNavigationRegion(readme)).not.toBeNull();
    const committed = git(fixture.knowledgeRoot, ["show", "--pretty=", "--name-only", "HEAD"]);
    expect(committed).toContain("README.md");
    expect(committed).toContain("docs/api/backoff.md");
    expect(git(fixture.knowledgeRoot, ["status", "--porcelain"]).trim()).toBe("");
  });

  test("updates navigation after a document deletion", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-nav-delete-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] },
      { id: "api/legacy.md", content: knowledgeDoc("guide", "Legacy notes", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    fs.rmSync(path.join(fixture.knowledgeRoot, "docs", "api", "legacy.md"));
    const reviewId = await generate(fixture);
    await confirm(fixture, reviewId);
    await seal(fixture, reviewId);
    const readme = fs.readFileSync(path.join(fixture.knowledgeRoot, "README.md"), "utf8");
    expect(readme).not.toContain("(docs/api/legacy.md)");
    expect(readme).toContain("(docs/api/retry.md)");
  });

  test("invalidates before publication when the README human region changes after review", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-nav-external-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    writeFile(fixture.knowledgeRoot, "docs/api/new.md", knowledgeDoc("guide", "New guide", { paths: ["src/api/retry.ts"] }));
    const reviewId = await generate(fixture);
    await confirm(fixture, reviewId);
    const k0 = head(fixture.knowledgeRoot);

    await expectKnowledgeError(
      () =>
        sealKnowledgeReview({
          sourceInput: fixture.source,
          registryDir: fixture.registryDir,
          reviewId,
          testHooks: {
            beforePublish: () => {
              const readmePath = path.join(fixture.knowledgeRoot, "README.md");
              const current = fs.readFileSync(readmePath, "utf8");
              fs.writeFileSync(readmePath, `# External human edit\n\n${current}`);
            }
          }
        }),
      "E_REVIEW_INVALIDATED",
      3
    );

    // The publication is refused before the CAS: HEAD is unchanged and the human edit survives.
    expect(head(fixture.knowledgeRoot)).toBe(k0);
    expect(fs.readFileSync(path.join(fixture.knowledgeRoot, "README.md"), "utf8")).toContain("# External human edit");
    expect(git(fixture.knowledgeRoot, ["ls-tree", "-r", "--name-only", "HEAD"])).not.toContain("docs/api/new.md");
  });

  test("formal search never returns navigation text", async () => {
    const fixture = await createKnowledgeFixture("llmdoc-nav-search-", { "src/api/retry.ts": "export const retry = 1;\n" }, [
      { id: "api/retry.md", content: knowledgeDoc("guide", "Retry policy", { paths: ["src/api/retry.ts"] }), scope: ["src/api/retry.ts"] }
    ]);
    const reviewId = await generate(fixture);
    await confirm(fixture, reviewId);
    await seal(fixture, reviewId);
    const { runSearch } = await import("../src/commands/search.js");
    const found = (await runSearch("Knowledge map", {
      cwd: fixture.source,
      source: fixture.source,
      knowledge: fixture.knowledgeRoot
    })) as { results: unknown[] };
    expect(found.results).toEqual([]);
  });
});
