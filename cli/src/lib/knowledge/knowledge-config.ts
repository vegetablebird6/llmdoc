import fs from "node:fs";
import path from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { load, dump } from "js-yaml";

import { KnowledgeError, runFileSystemIo } from "./errors.js";
import { runGit } from "./git-core.js";
import type { GitRepoLayout } from "./git-core.js";
import { packageRootFromImport } from "../package-root.js";

export const KNOWLEDGE_LAYOUT_SCHEMA = "llmdoc.knowledge/v1";

export interface KnowledgeRemote {
  name: string;
  url: string;
}

export interface KnowledgeLayoutConfig {
  schema: typeof KNOWLEDGE_LAYOUT_SCHEMA;
  repositoryId: string;
  layoutVersion: 1;
  remotes: KnowledgeRemote[];
}

export const KNOWLEDGE_CONFIG_FILENAME = "llmdoc.yaml";

type AjvConstructor = new (options: { allErrors: boolean; strict: boolean }) => {
  compile: (schema: unknown) => ValidateFunction;
};

type ValidatedKnowledgeLayoutConfig = Omit<KnowledgeLayoutConfig, "remotes"> & { remotes?: KnowledgeRemote[] };

let cachedValidateConfig: ValidateFunction | null = null;

export function knowledgeConfigPath(knowledgeRoot: string): string {
  return path.join(knowledgeRoot, KNOWLEDGE_CONFIG_FILENAME);
}

export function loadKnowledgeLayoutConfig(knowledgeRoot: string): KnowledgeLayoutConfig | null {
  const filePath = knowledgeConfigPath(knowledgeRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = runFileSystemIo(() => fs.readFileSync(filePath, "utf8"), "Failed to read llmdoc.yaml", [filePath]);
  return parseKnowledgeLayoutConfig(raw, filePath);
}

/** Parses llmdoc.yaml from raw content so identity/layout can be read from a fixed Knowledge revision. */
export function parseKnowledgeLayoutConfig(raw: string, label: string): KnowledgeLayoutConfig {
  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch (error) {
    throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", `llmdoc.yaml is not valid YAML: ${(error as Error).message}`, {
      paths: [label]
    });
  }
  return validateKnowledgeLayoutConfig(parsed, label);
}

export function validateKnowledgeLayoutConfig(parsed: unknown, filePath: string): KnowledgeLayoutConfig {
  const validateConfig = (cachedValidateConfig ??= compileKnowledgeSchema());
  if (!validateConfig(parsed)) {
    throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", `llmdoc.yaml is invalid: ${formatSchemaErrors(validateConfig.errors ?? [])}`, {
      paths: [filePath]
    });
  }
  const config = parsed as ValidatedKnowledgeLayoutConfig;
  return {
    schema: config.schema,
    repositoryId: config.repositoryId,
    layoutVersion: config.layoutVersion,
    remotes: (config.remotes ?? []).map((remote) => ({ name: remote.name, url: stripUrlCredentials(remote.url) }))
  };
}

function compileKnowledgeSchema(): ValidateFunction {
  let schemaPath = "schemas/knowledge.schema.json";
  try {
    schemaPath = path.join(packageRootFromImport(import.meta.url), "schemas", "knowledge.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as unknown;
    const Ajv2020 = Ajv2020Module as unknown as AjvConstructor;
    return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  } catch (error) {
    throw new KnowledgeError("E_FILESYSTEM_IO", `Failed to load packaged knowledge schema: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [schemaPath],
      remediation: "Reinstall llmdoc; the packaged knowledge schema is missing or invalid."
    });
  }
}

function formatSchemaErrors(errors: ErrorObject[]): string {
  return errors
    .map((error) => {
      if (error.keyword === "additionalProperties") {
        return `${error.instancePath || "/"} has an unknown key: ${String(error.params.additionalProperty)}`;
      }
      return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
    })
    .join("; ");
}

export function renderKnowledgeLayoutConfig(config: KnowledgeLayoutConfig): string {
  return dump(
    {
      schema: config.schema,
      repositoryId: config.repositoryId,
      layoutVersion: config.layoutVersion,
      remotes: config.remotes
    },
    { lineWidth: -1 }
  );
}

export function stripUrlCredentials(input: string): string {
  try {
    const url = new URL(input);
    if (url.username === "" && url.password === "") {
      return input;
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return input;
  }
}

export async function collectSourceRemotes(sourceLayout: GitRepoLayout): Promise<KnowledgeRemote[]> {
  const output = await runGit(sourceLayout, ["remote", "-v"]);
  const remotes: KnowledgeRemote[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\t(\S+) \(fetch\)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const name = match[1]!;
    const key = `${name}\u0000${match[2]}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    remotes.push({ name, url: stripUrlCredentials(match[2]!) });
  }
  remotes.sort((left, right) => left.name.localeCompare(right.name) || left.url.localeCompare(right.url));
  return remotes;
}
