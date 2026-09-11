export type KnowledgeErrorCode =
  | "E_SOURCE_REPO_NOT_FOUND"
  | "E_KNOWLEDGE_REPO_NOT_FOUND"
  | "E_GIT_IDENTITY_CONFLICT"
  | "E_KNOWLEDGE_ROOT_NOT_WORKTREE"
  | "E_NESTED_MODE_REQUIRED"
  | "E_NESTED_NOT_INSIDE_SOURCE"
  | "E_NESTED_TRACKED_BY_OUTER"
  | "E_KNOWLEDGE_CONTAINS_SOURCE"
  | "E_GIT_INVOCATION_FAILED"
  | "E_KNOWLEDGE_CONFIG_INVALID"
  | "E_KNOWLEDGE_NOT_INITIALIZED"
  | "E_INIT_TARGET_NOT_EMPTY"
  | "E_BINDING_NOT_FOUND"
  | "E_BINDING_AMBIGUOUS"
  | "E_BINDING_CONFLICT"
  | "E_SOURCE_IDENTITY_MISMATCH"
  | "E_REGISTRY_INVALID"
  | "E_REGISTRY_LOCKED"
  | "E_REGISTRY_UNAVAILABLE"
  | "E_FILESYSTEM_IO"
  | "E_DOCUMENT_INVALID"
  | "E_META_INVALID"
  | "E_KNOWLEDGE_DOC_NOT_FOUND"
  | "E_INVALID_KIND"
  | "E_INVALID_SOURCE_FILE";

export interface KnowledgeErrorOptions {
  paths?: string[];
  remediation?: string;
  exitCode?: number;
}

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;
  readonly exitCode: number;
  readonly paths: string[];
  readonly remediation: string;

  constructor(code: KnowledgeErrorCode, message: string, options: KnowledgeErrorOptions = {}) {
    super(message);
    this.name = "KnowledgeError";
    this.code = code;
    this.exitCode = options.exitCode ?? 2;
    this.paths = options.paths ?? [];
    this.remediation = options.remediation ?? "";
  }
}

export function runFileSystemIo<T>(operation: () => T, message: string, paths: string[]): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof KnowledgeError) {
      throw error;
    }
    throw new KnowledgeError("E_FILESYSTEM_IO", `${message}: ${(error as Error).message}`, {
      exitCode: 70,
      paths,
      remediation: "Check that the path exists, is a directory, and is writable; llmdoc reports filesystem failures as transaction/IO errors."
    });
  }
}
