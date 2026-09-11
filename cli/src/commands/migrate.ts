import { migrateKnowledge, type MigrateResult } from "../lib/knowledge/migrate.js";

export interface MigrateCommandOptions {
  cwd: string;
  source?: string;
  legacy?: string;
  knowledge: string;
  nested?: boolean;
  registryDir?: string;
  json?: boolean;
  dryRun?: boolean;
}

export interface MigrateCommandResult {
  output: unknown;
  exitCode: number;
}

export async function runMigrate(options: MigrateCommandOptions): Promise<MigrateCommandResult> {
  const result: MigrateResult = await migrateKnowledge({
    sourceInput: options.source ?? options.cwd,
    legacyInput: options.legacy,
    knowledgeInput: options.knowledge,
    nested: options.nested,
    registryDir: options.registryDir,
    dryRun: options.dryRun === true
  });
  return { output: result, exitCode: 0 };
}
