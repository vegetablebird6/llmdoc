import { bindKnowledge } from "../lib/knowledge/bind.js";

export interface BindCommandOptions {
  source: string;
  knowledge: string;
  nested?: boolean;
}

export async function runBind(options: BindCommandOptions) {
  return bindKnowledge({
    sourceInput: options.source,
    knowledgeInput: options.knowledge,
    nested: options.nested === true
  });
}
