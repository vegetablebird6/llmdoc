import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NgError } from "./errors.js";
import { runFileSystemIo } from "./errors.js";
import { REPOSITORY_ID_PATTERN } from "./identity.js";
import { sameRealPath } from "./paths.js";

export const REGISTRY_SCHEMA = "llmdoc.bindings/v1";
export const REGISTRY_FILENAME = "bindings.json";
export const REGISTRY_LOCK_FILENAME = "bindings.lock";

export interface BindingEntry {
  repositoryId: string;
  sourcePath: string;
  knowledgeRoot: string;
}

export interface RegistryDocument {
  schema: typeof REGISTRY_SCHEMA;
  bindings: BindingEntry[];
}

export function emptyRegistryDocument(): RegistryDocument {
  return { schema: REGISTRY_SCHEMA, bindings: [] };
}

export function resolveRegistryDir(explicitDir?: string): string {
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new NgError("E_REGISTRY_UNAVAILABLE", "Cannot resolve the user registry directory: APPDATA is not set", {
        exitCode: 70,
        remediation: "Set APPDATA or pass an explicit registry directory."
      });
    }
    return path.join(appData, "llmdoc");
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "llmdoc");
}

export function registryFilePath(registryDir: string): string {
  return path.join(registryDir, REGISTRY_FILENAME);
}

export function readRegistryDocument(registryDir: string): RegistryDocument {
  const filePath = registryFilePath(registryDir);
  if (!fs.existsSync(filePath)) {
    return emptyRegistryDocument();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(runFileSystemIo(() => fs.readFileSync(filePath, "utf8"), "Failed to read the binding registry", [filePath]));
  } catch (error) {
    if (error instanceof NgError) {
      throw error;
    }
    throw new NgError("E_REGISTRY_INVALID", `bindings.json is not valid JSON: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [filePath],
      remediation: "Fix or remove the registry file; llmdoc never rewrites it silently."
    });
  }
  return validateRegistryDocument(parsed, filePath);
}

export function validateRegistryDocument(parsed: unknown, filePath: string): RegistryDocument {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NgError("E_REGISTRY_INVALID", "bindings.json must contain a mapping", { paths: [filePath] });
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== REGISTRY_SCHEMA) {
    throw new NgError("E_REGISTRY_INVALID", `bindings.json schema must be ${REGISTRY_SCHEMA}`, { paths: [filePath] });
  }
  if (!Array.isArray(record.bindings)) {
    throw new NgError("E_REGISTRY_INVALID", "bindings.json bindings must be an array", { paths: [filePath] });
  }
  const bindings: BindingEntry[] = record.bindings.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new NgError("E_REGISTRY_INVALID", `bindings.json entry ${index} must be a mapping`, { paths: [filePath] });
    }
    const entry = item as Record<string, unknown>;
    for (const field of ["repositoryId", "sourcePath", "knowledgeRoot"] as const) {
      if (typeof entry[field] !== "string" || (entry[field] as string).length === 0) {
        throw new NgError("E_REGISTRY_INVALID", `bindings.json entry ${index} is missing string field ${field}`, {
          paths: [filePath]
        });
      }
    }
    if (!REPOSITORY_ID_PATTERN.test(entry.repositoryId as string)) {
      throw new NgError(
        "E_REGISTRY_INVALID",
        `bindings.json entry ${index} has an invalid repositoryId (expected llmdoc-<32 hex>)`,
        { paths: [filePath] }
      );
    }
    return {
      repositoryId: entry.repositoryId as string,
      sourcePath: entry.sourcePath as string,
      knowledgeRoot: entry.knowledgeRoot as string
    };
  });
  return { schema: REGISTRY_SCHEMA, bindings };
}

export function findBindingsBySourcePath(document: RegistryDocument, sourceRealPath: string): BindingEntry[] {
  return document.bindings.filter((entry) => sameRealPath(entry.sourcePath, sourceRealPath));
}

export function findBindingsByKnowledgeRoot(document: RegistryDocument, knowledgeRealPath: string): BindingEntry[] {
  return document.bindings.filter((entry) => sameRealPath(entry.knowledgeRoot, knowledgeRealPath));
}

export function insertBinding(document: RegistryDocument, entry: BindingEntry): void {
  document.bindings.push(entry);
}

export function writeRegistryDocument(registryDir: string, document: RegistryDocument): void {
  runFileSystemIo(() => fs.mkdirSync(registryDir, { recursive: true }), "Failed to create the registry directory", [registryDir]);
  const filePath = registryFilePath(registryDir);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  runFileSystemIo(
    () => fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8" }),
    "Failed to stage the registry update",
    [registryDir]
  );
  try {
    runFileSystemIo(() => fs.renameSync(tempPath, filePath), "Failed to publish the registry update", [registryDir]);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // temp cleanup is best-effort; the rename failure is the reportable error
    }
    throw error;
  }
}

export interface RegistryLockOwner {
  ownerToken: string;
  pid: number;
  host: string;
  acquiredAt: string;
}

export async function withRegistryLock<T>(registryDir: string, operation: () => T | Promise<T>): Promise<T> {
  runFileSystemIo(() => fs.mkdirSync(registryDir, { recursive: true }), "Failed to create the registry directory", [registryDir]);
  const lockPath = path.join(registryDir, REGISTRY_LOCK_FILENAME);
  const ownerToken = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const lockPayload = JSON.stringify({
    ownerToken,
    pid: process.pid,
    host: os.hostname(),
    acquiredAt: new Date().toISOString()
  } satisfies RegistryLockOwner);

  let acquired = false;
  for (let attempt = 0; attempt < 40 && !acquired; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(handle, lockPayload, "utf8");
      } finally {
        fs.closeSync(handle);
      }
      acquired = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        continue;
      }
      throw new NgError("E_FILESYSTEM_IO", `Failed to acquire the registry lock: ${(error as Error).message}`, {
        exitCode: 70,
        paths: [lockPath],
        remediation: "Check that the registry directory is usable; llmdoc reports filesystem failures as transaction/IO errors."
      });
    }
  }
  if (!acquired) {
    let ownerSummary = "unknown holder";
    try {
      const raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<RegistryLockOwner>;
      ownerSummary = `pid ${raw.pid ?? "?"} on ${raw.host ?? "?"} since ${raw.acquiredAt ?? "?"}`;
    } catch {
      // unreadable lock still blocks; report generic holder
    }
    throw new NgError("E_REGISTRY_LOCKED", "The user binding registry is locked by another writer", {
      exitCode: 70,
      paths: [lockPath],
      remediation: `Retry shortly; if the holder is gone, remove the lock manually. Holder: ${ownerSummary}. llmdoc never deletes locks automatically.`
    });
  }

  try {
    return await operation();
  } finally {
    try {
      const raw = fs.readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryLockOwner>;
      if (parsed.ownerToken === ownerToken) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {
      // if the lock cannot be confirmed as ours, leave it in place rather than deleting a foreign lock
    }
  }
}
