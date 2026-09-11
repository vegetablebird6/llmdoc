import fs from "node:fs";
import path from "node:path";

import { load, dump } from "js-yaml";

import { KnowledgeError, runFileSystemIo } from "./errors.js";
import { REPOSITORY_ID_PATTERN } from "./identity.js";
import { runGit } from "./git-core.js";
import type { GitRepoLayout } from "./git-core.js";

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
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", "llmdoc.yaml must contain a mapping", { paths: [filePath] });
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== KNOWLEDGE_LAYOUT_SCHEMA) {
    throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", `llmdoc.yaml schema must be ${KNOWLEDGE_LAYOUT_SCHEMA}`, {
      paths: [filePath]
    });
  }
  if (!REPOSITORY_ID_PATTERN.test(String(record.repositoryId ?? ""))) {
    throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", "llmdoc.yaml is missing a valid repositoryId (llmdoc-<32 hex>)", {
      paths: [filePath]
    });
  }
  const remotes = validateRemotes(record.remotes, filePath);
  if (record.layoutVersion !== 1) {
    throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", "llmdoc.yaml layoutVersion must be 1", { paths: [filePath] });
  }
  return {
    schema: KNOWLEDGE_LAYOUT_SCHEMA,
    repositoryId: String(record.repositoryId),
    layoutVersion: 1,
    remotes
  };
}

function validateRemotes(input: unknown, filePath: string): KnowledgeRemote[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", "llmdoc.yaml remotes must be a list of {name, url}", {
      paths: [filePath]
    });
  }
  return input.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", "llmdoc.yaml remotes entries must be mappings", {
        paths: [filePath]
      });
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== "string" || entry.name.length === 0 || typeof entry.url !== "string") {
      throw new KnowledgeError("E_KNOWLEDGE_CONFIG_INVALID", "llmdoc.yaml remotes entries need non-empty name and url strings", {
        paths: [filePath]
      });
    }
    return { name: entry.name, url: stripUrlCredentials(entry.url) };
  });
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
