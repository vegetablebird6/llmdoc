import { NgError } from "./errors.js";
import { resolveSourceContext, resolveKnowledgeContext } from "./contexts.js";
import { loadKnowledgeLayoutConfig } from "./knowledge-config.js";
import { sameRealPath } from "./paths.js";
import {
  findBindingsByKnowledgeRoot,
  findBindingsBySourcePath,
  insertBinding,
  readRegistryDocument,
  resolveRegistryDir,
  withRegistryLock,
  writeRegistryDocument
} from "./registry.js";

export interface BindOptions {
  sourceInput: string;
  knowledgeInput: string;
  nested?: boolean;
  registryDir?: string;
}

export interface BindResult {
  status: "bound" | "already-bound";
  repositoryId: string;
  sourcePath: string;
  knowledgeRoot: string;
}

export async function bindKnowledge(options: BindOptions): Promise<BindResult> {
  const source = await resolveSourceContext(options.sourceInput);
  const knowledge = await resolveKnowledgeContext(options.knowledgeInput, {
    source,
    mode: options.nested ? "nested" : "external"
  });
  const config = loadKnowledgeLayoutConfig(knowledge.worktreeRoot);
  if (config === null) {
    throw new NgError("E_KNOWLEDGE_NOT_INITIALIZED", "The knowledge repository has no llmdoc.yaml; bind associates existing llmdoc identities and never creates them", {
      paths: [knowledge.worktreeRoot],
      remediation: "Run `llmdoc init` (or the explicit migration flow) to create the knowledge layout and identity first."
    });
  }
  const registryDir = resolveRegistryDir(options.registryDir);
  return withRegistryLock(registryDir, () => {
    const document = readRegistryDocument(registryDir);
    const bySource = findBindingsBySourcePath(document, source.worktreeRoot);
    const identical = bySource.find(
      (entry) => sameRealPath(entry.knowledgeRoot, knowledge.worktreeRoot) && entry.repositoryId === config.repositoryId
    );
    if (identical) {
      return {
        status: "already-bound",
        repositoryId: config.repositoryId,
        sourcePath: source.worktreeRoot,
        knowledgeRoot: knowledge.worktreeRoot
      };
    }
    if (bySource.length > 0) {
      throw new NgError("E_BINDING_CONFLICT", "This source worktree is already bound to a different knowledge root or identity", {
        paths: bySource.map((entry) => entry.knowledgeRoot),
        remediation: "Explicit rebinding is refused; update the user registry deliberately if the old binding is stale."
      });
    }
    const byKnowledge = findBindingsByKnowledgeRoot(document, knowledge.worktreeRoot);
    if (byKnowledge.length > 0) {
      throw new NgError("E_BINDING_CONFLICT", "The knowledge root is already bound to another source path", {
        paths: byKnowledge.map((entry) => entry.sourcePath),
        remediation: "Each knowledge repository serves exactly one bound source worktree; clones, forks and worktrees need their own explicit bindings."
      });
    }
    insertBinding(document, {
      repositoryId: config.repositoryId,
      sourcePath: source.worktreeRoot,
      knowledgeRoot: knowledge.worktreeRoot
    });
    writeRegistryDocument(registryDir, document);
    return {
      status: "bound",
      repositoryId: config.repositoryId,
      sourcePath: source.worktreeRoot,
      knowledgeRoot: knowledge.worktreeRoot
    };
  });
}
