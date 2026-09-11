import { KnowledgeError } from "./errors.js";
import { resolveSourceContext, resolveKnowledgeContext, type KnowledgeContext, type SourceContext } from "./contexts.js";
import { isWithinRootReal, sameRealPath } from "./paths.js";
import { findBindingsBySourcePath, readRegistryDocument, resolveRegistryDir, type BindingEntry } from "./registry.js";
import { loadKnowledgeLayoutConfig } from "./knowledge-config.js";

export interface ResolveWriteBindingOptions {
  sourceInput: string;
  knowledgeInput?: string;
  nested?: boolean;
  registryDir?: string;
}

export interface PreciseBinding {
  source: SourceContext;
  knowledge: KnowledgeContext;
  entry: BindingEntry;
}

export async function resolveWriteBinding(options: ResolveWriteBindingOptions): Promise<PreciseBinding> {
  const source = await resolveSourceContext(options.sourceInput);
  const document = readRegistryDocument(resolveRegistryDir(options.registryDir));
  const candidates = findBindingsBySourcePath(document, source.worktreeRoot);
  if (candidates.length === 0) {
    throw new KnowledgeError("E_BINDING_NOT_FOUND", "No llmdoc binding exists for this source worktree; write operations require an explicitly established binding", {
      paths: [source.worktreeRoot],
      remediation:
        "Run `llmdoc init` to create a knowledge repository or `llmdoc bind` to associate an existing one. Passing a path alone never grants write identity."
    });
  }
  if (candidates.length > 1) {
    throw new KnowledgeError("E_BINDING_AMBIGUOUS", "The registry contains multiple bindings for this source worktree", {
      paths: candidates.map((entry) => entry.knowledgeRoot),
      remediation: "Disambiguate by editing the user registry so exactly one binding matches this source path."
    });
  }
  const entry = candidates[0]!;
  const knowledgeInput = options.knowledgeInput ?? entry.knowledgeRoot;
  const knowledge = await resolveKnowledgeContext(knowledgeInput, {
    source,
    mode: options.nested ? "nested" : isWithinRootReal(source.worktreeRoot, entry.knowledgeRoot) ? "nested" : "external"
  });
  if (options.knowledgeInput !== undefined && !sameRealPath(knowledge.worktreeRoot, entry.knowledgeRoot)) {
    throw new KnowledgeError("E_BINDING_CONFLICT", "The explicit knowledge root conflicts with the existing binding for this source worktree", {
      paths: [knowledge.worktreeRoot, entry.knowledgeRoot],
      remediation: "Use the bound knowledge root or update the binding explicitly with `llmdoc bind`; llmdoc does not auto-modify bindings."
    });
  }
  const config = loadKnowledgeLayoutConfig(knowledge.worktreeRoot);
  if (config === null) {
    throw new KnowledgeError("E_KNOWLEDGE_NOT_INITIALIZED", "The knowledge repository has no llmdoc.yaml; bind and write operations require an llmdoc-initialized knowledge repository", {
      paths: [knowledge.worktreeRoot],
      remediation: "Run `llmdoc init` (or the explicit migration flow) to create the knowledge layout and identity."
    });
  }
  if (config.repositoryId !== entry.repositoryId) {
    throw new KnowledgeError("E_SOURCE_IDENTITY_MISMATCH", "The knowledge repository identity does not match the binding registry", {
      paths: [knowledge.worktreeRoot],
      remediation: `The registry associates this source with ${entry.repositoryId}, but the knowledge repository declares ${config.repositoryId}. Verify the paths or rebind explicitly.`
    });
  }
  source.repositoryId = entry.repositoryId;
  return { source, knowledge, entry };
}
