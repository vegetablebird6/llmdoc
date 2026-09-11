import { initKnowledgeRepository } from "../lib/v3ng/init.js";

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
