import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildReviewManifest,
  confirmReviewManifest,
  loadReviewManifest,
  reviewFilePath,
  writeReviewManifest,
  type ReviewManifest
} from "../src/lib/knowledge/review.js";
import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import { resolveKnowledgeWriteContext } from "../src/lib/knowledge/write-context.js";
import { createKnowledgeFixture, knowledgeDoc, makeTempDir, writeFile, type KnowledgeFixture } from "./knowledge-helpers.js";

const createdDirs: string[] = [];

afterAll(async () => {
  for (const dir of createdDirs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort
    }
  }
});

async function makeFixture(prefix: string): Promise<KnowledgeFixture> {
  const fixture = await createKnowledgeFixture(
    prefix,
    { "src/a.ts": "export const a = 1;\n" },
    [{ id: "a.md", content: knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n" }), scope: ["src/a.ts"] }]
  );
  createdDirs.push(fixture.base);
  return fixture;
}

function fixtureOptions(fixture: KnowledgeFixture) {
  return { sourceInput: fixture.source, knowledgeInput: fixture.knowledgeRoot, registryDir: fixture.registryDir };
}

async function writeFreshManifest(fixture: KnowledgeFixture): Promise<ReviewManifest> {
  const context = await resolveKnowledgeWriteContext(fixtureOptions(fixture));
  const manifest = buildReviewManifest(context);
  writeReviewManifest(fixture.knowledgeRoot, manifest);
  return manifest;
}

function tamper(fixture: KnowledgeFixture, manifest: ReviewManifest, mutate: (copy: ReviewManifest) => void): ReviewManifest {
  const copy = JSON.parse(JSON.stringify(manifest)) as ReviewManifest;
  mutate(copy);
  fs.writeFileSync(reviewFilePath(fixture.knowledgeRoot, manifest.reviewId), `${JSON.stringify(copy, null, 2)}\n`);
  return copy;
}

async function expectReviewInvalid(run: () => unknown | Promise<unknown>): Promise<KnowledgeError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    expect((error as KnowledgeError).code).toBe("E_REVIEW_INVALID");
    expect((error as KnowledgeError).exitCode).toBe(2);
    return error as KnowledgeError;
  }
  throw new Error("expected E_REVIEW_INVALID, but the call succeeded");
}

describe("review manifest safety", () => {
  it("rejects malformed or escaping review ids before touching any path", async () => {
    const fixture = await makeFixture("llmdoc-manifest-id-");
    for (const id of ["../evil", "..\\evil", "not-hex", "ABCDEF", "a".repeat(31), "a".repeat(33)]) {
      expect(() => reviewFilePath(fixture.knowledgeRoot, id)).toThrow(KnowledgeError);
      await expectReviewInvalid(() => loadReviewManifest(fixture.knowledgeRoot, id));
    }
    expect(fs.existsSync(path.join(fixture.knowledgeRoot, ".llmdoc-cache", "reviews"))).toBe(false);
  });

  it("requires the cached manifest reviewId to match the requested id", async () => {
    const fixture = await makeFixture("llmdoc-manifest-mismatch-");
    const manifest = await writeFreshManifest(fixture);
    tamper(fixture, manifest, (copy) => {
      copy.reviewId = "0".repeat(32);
    });
    await expectReviewInvalid(() => loadReviewManifest(fixture.knowledgeRoot, manifest.reviewId));
  });

  it("refuses to load or confirm a manifest whose roots or identity do not match the binding", async () => {
    const fixture = await makeFixture("llmdoc-manifest-roots-");
    const manifest = await writeFreshManifest(fixture);
    const context = await resolveKnowledgeWriteContext(fixtureOptions(fixture));
    const outside = makeTempDir("llmdoc-manifest-outside-");
    createdDirs.push(outside);

    const tamperedKnowledgeRoot = tamper(fixture, manifest, (copy) => {
      copy.knowledgeRoot = outside;
    });
    await expectReviewInvalid(() => loadReviewManifest(fixture.knowledgeRoot, manifest.reviewId));
    await expectReviewInvalid(() => confirmReviewManifest(context, tamperedKnowledgeRoot));
    expect(fs.existsSync(path.join(outside, ".llmdoc-cache"))).toBe(false);

    const tamperedSourceRoot = tamper(fixture, manifest, (copy) => {
      copy.sourceRoot = outside;
    });
    await expectReviewInvalid(() => confirmReviewManifest(context, tamperedSourceRoot));

    const tamperedIdentity = tamper(fixture, manifest, (copy) => {
      copy.repositoryId = "llmdoc-" + "f".repeat(32);
    });
    try {
      confirmReviewManifest(context, tamperedIdentity);
      throw new Error("expected identity mismatch");
    } catch (error) {
      expect((error as KnowledgeError).code).toBe("E_SOURCE_IDENTITY_MISMATCH");
    }

    const tamperedSourceRevision = tamper(fixture, manifest, (copy) => {
      copy.sourceRevision = "0".repeat(40);
    });
    try {
      confirmReviewManifest(context, tamperedSourceRevision);
      throw new Error("expected source drift");
    } catch (error) {
      expect((error as KnowledgeError).code).toBe("E_SOURCE_HEAD_DRIFT");
    }

    const tamperedBaseRevision = tamper(fixture, manifest, (copy) => {
      copy.knowledgeBaseRevision = "0".repeat(40);
    });
    try {
      confirmReviewManifest(context, tamperedBaseRevision);
      throw new Error("expected knowledge head mismatch");
    } catch (error) {
      expect((error as KnowledgeError).code).toBe("E_KNOWLEDGE_HEAD_MISMATCH");
    }
  });

  it("rejects a structurally malformed manifest instead of trusting it", async () => {
    const fixture = await makeFixture("llmdoc-manifest-malformed-");
    const filePath = path.join(fixture.knowledgeRoot, ".llmdoc-cache", "reviews");
    fs.mkdirSync(filePath, { recursive: true });
    const id = "a".repeat(32);
    const target = path.join(filePath, `${id}.json`);
    for (const bad of [
      { schema: "wrong" },
      { schema: "llmdoc.review/v1", reviewId: id, repositoryId: "bad", documents: [], writeSet: {} },
      { schema: "llmdoc.review/v1", reviewId: id, repositoryId: "llmdoc-" + "a".repeat(32), documents: "no", writeSet: {} }
    ]) {
      fs.writeFileSync(target, `${JSON.stringify(bad)}\n`);
      await expectReviewInvalid(() => loadReviewManifest(fixture.knowledgeRoot, id));
    }
  });

  it("rejects duplicates, write set inconsistencies and lifecycle contradictions instead of normalizing them", async () => {
    const fixture = await makeFixture("llmdoc-manifest-invariants-");
    writeFile(fixture.knowledgeRoot, "docs/a.md", knowledgeDoc("guide", "A", { paths: ["src/a.ts"], body: "# A\n\nchanged\n" }));
    const manifest = await writeFreshManifest(fixture);
    const digest = "sha256:" + "1".repeat(64);
    const oid = "a".repeat(40);
    const now = new Date().toISOString();

    const cases: Array<[string, (copy: ReviewManifest) => void]> = [
      ["duplicate document id", (copy) => copy.documents.push({ ...copy.documents[0]! })],
      [
        "duplicate candidateRequires id",
        (copy) => {
          copy.documents[0]!.candidateRequires = [
            { id: "b.md", digest },
            { id: "b.md", digest }
          ];
        }
      ],
      ["duplicate oldScope entry", (copy) => copy.documents[0]!.oldScope.push(copy.documents[0]!.oldScope[0]!)],
      ["duplicate reason", (copy) => copy.documents[0]!.reasons.push(copy.documents[0]!.reasons[0]!)],
      ["duplicate writeSet.documents entry", (copy) => copy.writeSet.documents.push(copy.writeSet.documents[0]!)],
      [
        "duplicate writeSet.refresh entry",
        (copy) => {
          copy.writeSet.documents = [];
          copy.writeSet.refresh = ["a.md", "a.md"];
        }
      ],
      [
        "duplicate writeSet.deletions entry",
        (copy) => {
          copy.writeSet.documents = [];
          copy.writeSet.deletions = ["a.md", "a.md"];
        }
      ],
      [
        "duplicate writeSet.candidates entry",
        (copy) => {
          copy.writeSet.candidates = ["candidate.md", "candidate.md"];
        }
      ],
      [
        "duplicate writeSet.generated entry",
        (copy) => {
          copy.writeSet.generated = [".llmdoc/meta.json", ".llmdoc/meta.json"];
        }
      ],
      [
        "writeSet documents and refresh overlap",
        (copy) => {
          copy.writeSet.refresh = [...copy.writeSet.documents];
        }
      ],
      [
        "writeSet refresh and deletions overlap",
        (copy) => {
          copy.writeSet.documents = [];
          copy.writeSet.refresh = ["a.md"];
          copy.writeSet.deletions = ["a.md"];
        }
      ],
      [
        "writeSet documents and deletions overlap",
        (copy) => {
          copy.writeSet.deletions = [...copy.writeSet.documents];
        }
      ],
      [
        "writeSet references an undeclared document",
        (copy) => {
          copy.writeSet.documents = ["zzz.md"];
        }
      ],
      [
        "generated contains an unknown path",
        (copy) => {
          copy.writeSet.generated = [".llmdoc/meta.json", "docs/a.md"];
        }
      ],
      [
        "meta=false with generated files",
        (copy) => {
          copy.writeSet.meta = false;
          copy.writeSet.generated = [".llmdoc/meta.json"];
        }
      ],
      [
        "meta=true without the meta file",
        (copy) => {
          copy.writeSet.meta = true;
          copy.writeSet.generated = ["README.md"];
        }
      ],
      [
        "unconfirmed manifest with a conclusion",
        (copy) => {
          copy.documents[0]!.conclusion = "changed";
        }
      ],
      [
        "confirmed manifest without conclusions",
        (copy) => {
          copy.confirmed = true;
          copy.confirmedAt = now;
        }
      ],
      [
        "confirmed manifest without confirmedAt",
        (copy) => {
          copy.confirmed = true;
          for (const item of copy.documents) {
            item.conclusion = item.proposedConclusion;
          }
        }
      ],
      [
        "unconfirmed manifest with confirmedAt",
        (copy) => {
          copy.confirmedAt = now;
        }
      ],
      [
        "consumed manifest that is not confirmed",
        (copy) => {
          copy.consumed = true;
          copy.consumedAt = now;
          copy.knowledgeRevision = oid;
        }
      ],
      [
        "unconsumed manifest with consumedAt",
        (copy) => {
          copy.consumedAt = now;
        }
      ],
      [
        "unconsumed manifest with knowledgeRevision",
        (copy) => {
          copy.knowledgeRevision = oid;
        }
      ],
      [
        "v1 global and advanceGlobalReview disagree",
        (copy) => {
          copy.global = !copy.global;
        }
      ]
    ];

    for (const [name, mutate] of cases) {
      const copy = JSON.parse(JSON.stringify(manifest)) as ReviewManifest;
      mutate(copy);
      fs.writeFileSync(reviewFilePath(fixture.knowledgeRoot, manifest.reviewId), `${JSON.stringify(copy, null, 2)}\n`);
      const error = await expectReviewInvalid(() => loadReviewManifest(fixture.knowledgeRoot, manifest.reviewId));
      expect(error.message, name).not.toHaveLength(0);
    }
  });
});
