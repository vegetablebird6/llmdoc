import { describe, expect, test } from "vitest";

import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import { parseKnowledgeLayoutConfig, validateKnowledgeLayoutConfig } from "../src/lib/knowledge/knowledge-config.js";

const REPOSITORY_ID = "llmdoc-0123456789abcdef0123456789abcdef";
const validConfig = { schema: "llmdoc.knowledge/v1", repositoryId: REPOSITORY_ID, layoutVersion: 1 };

function expectInvalid(config: unknown, message?: RegExp): void {
  try {
    validateKnowledgeLayoutConfig(config, "fixture/llmdoc.yaml");
    throw new Error("expected config validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    const knowledgeError = error as KnowledgeError;
    expect(knowledgeError.code).toBe("E_KNOWLEDGE_CONFIG_INVALID");
    expect(knowledgeError.exitCode).toBe(2);
    expect(knowledgeError.paths).toEqual(["fixture/llmdoc.yaml"]);
    if (message) {
      expect(knowledgeError.message).toMatch(message);
    }
  }
}

describe("knowledge layout config runtime contract", () => {
  test("defaults missing remotes to an empty list", () => {
    const input = { ...validConfig };
    expect(validateKnowledgeLayoutConfig(input, "llmdoc.yaml")).toEqual({
      ...validConfig,
      remotes: []
    });
    expect(input).not.toHaveProperty("remotes");
  });

  test("strips credentials from manually configured remote URLs", () => {
    expect(
      validateKnowledgeLayoutConfig(
        {
          ...validConfig,
          remotes: [{ name: "origin", url: "https://alice:secret@example.com/knowledge.git" }]
        },
        "llmdoc.yaml"
      ).remotes
    ).toEqual([{ name: "origin", url: "https://example.com/knowledge.git" }]);
  });

  test("reports unknown top-level and remote keys", () => {
    expectInvalid({ ...validConfig, secret: true }, /\/ has an unknown key: secret/);
    expectInvalid(
      { ...validConfig, remotes: [{ name: "origin", url: "https://example.com/k.git", secret: true }] },
      /\/remotes\/0 has an unknown key: secret/
    );
  });

  test.each([
    ["null document", null],
    ["top-level array", [validConfig]],
    ["missing schema", { repositoryId: REPOSITORY_ID, layoutVersion: 1 }],
    ["wrong schema", { ...validConfig, schema: "llmdoc.knowledge/v2" }],
    ["malformed repository id", { ...validConfig, repositoryId: "llmdoc-XYZ" }],
    ["unsupported layout version", { ...validConfig, layoutVersion: 2 }],
    ["non-array remotes", { ...validConfig, remotes: {} }],
    ["remote without URL", { ...validConfig, remotes: [{ name: "origin" }] }],
    ["remote with empty name", { ...validConfig, remotes: [{ name: "", url: "https://example.com/k.git" }] }]
  ])("rejects %s", (_name, config) => {
    expectInvalid(config);
  });

  test("preserves YAML parse errors as config errors", () => {
    try {
      parseKnowledgeLayoutConfig("schema: [", "broken/llmdoc.yaml");
      throw new Error("expected YAML parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeError);
      const knowledgeError = error as KnowledgeError;
      expect(knowledgeError.code).toBe("E_KNOWLEDGE_CONFIG_INVALID");
      expect(knowledgeError.exitCode).toBe(2);
      expect(knowledgeError.paths).toEqual(["broken/llmdoc.yaml"]);
      expect(knowledgeError.message).toMatch(/not valid YAML/);
    }
  });
});
