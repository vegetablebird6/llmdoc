import { initKnowledgeRepository } from "../lib/knowledge/init.js";

export interface InitCommandOptions {
  source: string;
  knowledge: string;
  nested?: boolean;
}

export async function runInit(options: InitCommandOptions) {
  return initKnowledgeRepository({
    sourceInput: options.source,
    knowledgeInput: options.knowledge,
    nested: options.nested === true
  });
}
