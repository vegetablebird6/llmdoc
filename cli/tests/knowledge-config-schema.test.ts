import fs from "node:fs";
import path from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";

import { KnowledgeError } from "../src/lib/knowledge/errors.js";
import { validateKnowledgeLayoutConfig } from "../src/lib/knowledge/knowledge-config.js";

type AjvConstructor = new (options: { allErrors: boolean; strict: boolean }) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
};

const Ajv2020 = Ajv2020Module as unknown as AjvConstructor;
const schemaPath = path.resolve(__dirname, "..", "schemas", "knowledge.schema.json");
const publishedSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaAccepts = ajv.compile(publishedSchema);

const REPOSITORY_ID = "llmdoc-0123456789abcdef0123456789abcdef";
const validConfig = { schema: "llmdoc.knowledge/v1", repositoryId: REPOSITORY_ID, layoutVersion: 1 };

function runtimeAccepts(config: unknown): boolean {
  try {
    validateKnowledgeLayoutConfig(config, "llmdoc.yaml");
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    expect((error as KnowledgeError).code).toBe("E_KNOWLEDGE_CONFIG_INVALID");
    expect((error as KnowledgeError).exitCode).toBe(2);
    return false;
  }
}

interface ConfigCase {
  name: string;
  config: unknown;
  accepted: boolean;
}

const cases: ConfigCase[] = [
  {
    name: "full valid config with remotes",
    config: { ...validConfig, remotes: [{ name: "origin", url: "https://example.com/knowledge.git" }] },
    accepted: true
  },
  { name: "minimal valid config without remotes", config: { ...validConfig }, accepted: true },
  { name: "explicit empty remotes list", config: { ...validConfig, remotes: [] }, accepted: true },
  {
    name: "unknown top-level key",
    config: { ...validConfig, extra: true },
    accepted: false
  },
  {
    name: "unknown remote entry key",
    config: { ...validConfig, remotes: [{ name: "origin", url: "https://example.com/k.git", extra: 1 }] },
    accepted: false
  },
  { name: "null remotes", config: { ...validConfig, remotes: null }, accepted: false },
  { name: "non-array remotes", config: { ...validConfig, remotes: {} }, accepted: false },
  {
    name: "remote entry missing url",
    config: { ...validConfig, remotes: [{ name: "origin" }] },
    accepted: false
  },
  {
    name: "remote entry with empty name",
    config: { ...validConfig, remotes: [{ name: "", url: "https://example.com/k.git" }] },
    accepted: false
  },
  {
    name: "remote entry with non-string url",
    config: { ...validConfig, remotes: [{ name: "origin", url: 7 }] },
    accepted: false
  },
  { name: "missing schema key", config: { repositoryId: REPOSITORY_ID, layoutVersion: 1 }, accepted: false },
  { name: "wrong schema id", config: { ...validConfig, schema: "llmdoc.knowledge/v2" }, accepted: false },
  { name: "malformed repositoryId", config: { ...validConfig, repositoryId: "llmdoc-XYZ" }, accepted: false },
  { name: "non-string repositoryId", config: { ...validConfig, repositoryId: 123 }, accepted: false },
  { name: "unsupported layoutVersion", config: { ...validConfig, layoutVersion: 2 }, accepted: false },
  { name: "stringly layoutVersion", config: { ...validConfig, layoutVersion: "1" }, accepted: false },
  { name: "top-level array", config: [validConfig], accepted: false },
  { name: "null document", config: null, accepted: false }
];

describe("knowledge layout config: runtime validator and published schema agree", () => {
  for (const testCase of cases) {
    test(`${testCase.accepted ? "accepts" : "rejects"} ${testCase.name}`, () => {
      const schemaResult = schemaAccepts(testCase.config);
      const runtimeResult = runtimeAccepts(testCase.config);
      expect(schemaResult).toBe(testCase.accepted);
      expect(runtimeResult).toBe(testCase.accepted);
      expect(schemaResult).toBe(runtimeResult);
    });
  }

  test("runtime reports E_KNOWLEDGE_CONFIG_INVALID with the offending key path for unknown keys", () => {
    expect(() => validateKnowledgeLayoutConfig({ ...validConfig, secret: 1 }, "llmdoc.yaml")).toThrow(
      /unknown key: secret/
    );
    expect(() =>
      validateKnowledgeLayoutConfig(
        { ...validConfig, remotes: [{ name: "origin", url: "https://example.com/k.git", secret: 1 }] },
        "llmdoc.yaml"
      )
    ).toThrow(/unknown key: secret/);
  });
});
