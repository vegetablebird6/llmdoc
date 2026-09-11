import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";

import { CliError } from "./lib/errors.js";
import { KnowledgeError } from "./lib/knowledge/errors.js";
import { runBind } from "./commands/bind.js";
import { runInit } from "./commands/init.js";
import { runTree } from "./commands/tree.js";
import { runIndex } from "./commands/index.js";
import { runShow } from "./commands/show.js";
import { runSearch } from "./commands/search.js";
import { runContext } from "./commands/context.js";
import { runValidate } from "./commands/validate.js";
import { runStatus } from "./commands/status.js";
import { runDelta } from "./commands/delta.js";
import { runReview } from "./commands/review.js";
import { runPrune } from "./commands/prune.js";
import { runHook } from "./commands/hook.js";
import { runServe, parseViewerPort } from "./commands/serve.js";
import { stringifyValidatedOutput, type OutputSchemaName } from "./lib/output-schema.js";
import { packageRootFromImport } from "./lib/package-root.js";

export interface RunCliResult {
  exitCode: number;
  stdout: string;
}

export async function runCli(argv: string[], cwd = process.cwd()): Promise<RunCliResult> {
  if (argv.includes("--version") || argv.includes("-V")) {
    return {
      exitCode: 0,
      stdout: readPackageVersion()
    };
  }
  const program = new Command();
  const output: string[] = [];
  let exitCode = 0;
  let globalOptions: { json?: boolean; cursor?: string; budget?: number; limit?: number };
  try {
    globalOptions = parseGlobalOptions(argv);
  } catch (error) {
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout: error.message
      };
    }
    throw error;
  }

  program
    .name("llmdoc")
    .description("llmdoc knowledge CLI: read committed knowledge, diagnose review obligations, and seal verified understanding into an independent Knowledge Git")
    .version(readPackageVersion(), "--version", "output the CLI version")
    .helpOption("-h, --help", "display help")
    .helpCommand("help [command]", "display help for a command")
    .showHelpAfterError("(use --help to view usage)");
  program
    .option("--json", "emit schema-validated JSON")
    .option("--cursor <cursor>", "continue from a cursor returned by a truncated response")
    .option("--budget <tokens>", "truncate output at this token budget and return a cursor", parseInteger)
    .option("--limit <n>", "maximum number of items to return", parseInteger);
  program.addHelpText(
    "after",
    [
      "",
      "Quick reference by purpose:",
      "  Retrieval (read-only)  tree → index / search / context → show",
      "  State diagnostics      status · delta",
      "  Structural checks      validate",
      "  Semantic commit        review → review --confirm → commit --review",
      "  Candidate capture      capture → update",
      "  Maintenance            prune · migrate",
      "  Host integration       hook · serve",
      "",
      "Common examples:",
      "  llmdoc tree                              show the knowledge map (topics and root documents)",
      "  llmdoc search \"retry policy\" --limit 5     search documents lexically",
      "  llmdoc status                              report review obligations and source blockers",
      "  llmdoc capture --title \"idea\" --from note.md   save an unverified inbox candidate",
      "  llmdoc review                              generate a Review Manifest for the fixed source snapshot",
      "  llmdoc commit --review <reviewId>          seal a confirmed manifest into one knowledge commit",
      "  llmdoc migrate --dry-run --knowledge <dir> report a legacy V3 migration without writing",
      "",
      "All retrieval commands support --json / --budget / --limit; use --cursor to continue truncated output."
    ].join("\n")
  );

  program
    .command("tree")
    .description("output the knowledge map (topics by default)")
    .option("--source <path>", "read the knowledge bound to this source worktree")
    .option("--knowledge <path>", "read this explicit knowledge root (may be an unbound no-Git directory)")
    .action(async (commandOptions) => {
      output.push(writeOutput("tree", await runTree({ ...globalOptions, ...commandOptions, cwd }), globalOptions.json));
    });

  program
    .command("index")
    .description("list document metadata without reading bodies")
    .option("--topic <topic>", "list documents only under this topic")
    .option("--kind <kind>", "filter by kind: architecture | decision | guide | reference")
    .option("--source <path>", "read the knowledge bound to this source worktree")
    .option("--knowledge <path>", "read this explicit knowledge root (may be an unbound no-Git directory)")
    .action(async (commandOptions) => {
      output.push(writeOutput("index", await runIndex({ ...globalOptions, ...commandOptions, cwd }), globalOptions.json));
    });

  program
    .command("show")
    .description("read one or more document bodies")
    .argument("<path...>", "paths relative to docs/, such as lifecycle/task-recovery.md")
    .option("--source <path>", "read the knowledge bound to this source worktree")
    .option("--knowledge <path>", "read this explicit knowledge root (may be an unbound no-Git directory)")
    .action(async (paths, commandOptions) => {
      output.push(writeOutput("show", await runShow(paths, { ...globalOptions, ...commandOptions, cwd }), globalOptions.json));
    });

  program
    .command("search")
    .description("search knowledge documents lexically (Chinese segmentation with CJK bigram fallback)")
    .argument("<query>", "search query")
    .option("--topic <topic>", "limit to a topic")
    .option("--kind <kind>", "filter by kind: architecture | decision | guide | reference")
    .option("--source <path>", "read the knowledge bound to this source worktree")
    .option("--knowledge <path>", "read this explicit knowledge root (may be an unbound no-Git directory)")
    .action(async (query, commandOptions) => {
      output.push(writeOutput("search", await runSearch(query, { ...globalOptions, ...commandOptions, cwd }), globalOptions.json));
    });

  program
    .command("context")
    .description("map source files to documents to read, including the requires closure")
    .requiredOption("--files <files...>", "one or more source file paths")
    .option("--source <path>", "read the knowledge bound to this source worktree")
    .option("--knowledge <path>", "read this explicit knowledge root (may be an unbound no-Git directory)")
    .action(async (commandOptions) => {
      output.push(writeOutput("context", await runContext(commandOptions.files, { ...globalOptions, ...commandOptions, cwd }), globalOptions.json));
    });

  program
    .command("validate")
    .description("validate knowledge structure and source evidence against the fixed source snapshot")
    .option("--source <path>", "validate the knowledge bound to this source worktree")
    .option("--knowledge <path>", "validate this explicit knowledge root")
    .action(async (commandOptions) => {
      const result = await runValidate({ ...globalOptions, ...commandOptions, cwd });
      exitCode = result.exitCode;
      output.push(writeOutput("validate", result.output, globalOptions.json));
    });

  program
    .command("status")
    .description("report source blockers, knowledge state and review obligations")
    .option("--source <path>", "inspect the knowledge bound to this source worktree")
    .option("--knowledge <path>", "inspect this explicit knowledge root")
    .action(async (commandOptions) => {
      output.push(writeOutput("status", await runStatus({ ...globalOptions, ...commandOptions, cwd }), globalOptions.json));
    });

  program
    .command("delta")
    .description("report the documents that need semantic review after source or knowledge changes")
    .option("--scope <scope...>", "limit comparison to selected document ids")
    .option("--source <path>", "inspect the knowledge bound to this source worktree")
    .option("--knowledge <path>", "inspect this explicit knowledge root")
    .action(async (commandOptions) => {
      output.push(writeOutput("delta", await runDelta({ ...globalOptions, ...commandOptions, cwd }), globalOptions.json));
    });

  program
    .command("review")
    .description("generate or confirm a Review Manifest for the fixed source and knowledge revisions")
    .option("--source <path>", "review the knowledge bound to this source worktree")
    .option("--knowledge <path>", "review this explicit knowledge root")
    .option("--confirm <reviewId>", "confirm the semantic conclusions of an existing manifest")
    .option("--set <assignment...>", "override a conclusion when confirming: <id>=changed|unchanged|insufficient")
    .option("--global", "record this as a global review scan, advancing lastGlobalReviewRevision on seal")
    .action(async (commandOptions) => {
      const result = await runReview({ ...globalOptions, ...commandOptions, cwd });
      exitCode = result.exitCode;
      output.push(writeOutput("review", result.output, globalOptions.json));
    });

  program
    .command("commit")
    .description("seal a confirmed Review Manifest into a single knowledge commit")
    .requiredOption("--review <reviewId>", "confirmed review manifest to consume")
    .option("--source <path>", "seal the knowledge bound to this source worktree")
    .option("--knowledge <path>", "seal this explicit knowledge root")
    .addHelpText(
      "after",
      "\ncommit consumes a confirmed Review Manifest; there is no bare verified flag. Knowledge staging, a dirty or invalid source snapshot, and any content drift invalidate the manifest."
    )
    .action(async (commandOptions) => {
      const { runCommit } = await import("./commands/commit.js");
      const result = await runCommit({
        ...globalOptions,
        cwd,
        source: commandOptions.source,
        knowledge: commandOptions.knowledge,
        review: commandOptions.review
      });
      exitCode = result.exitCode;
      output.push(writeOutput("commit", result.output, globalOptions.json));
    });

  program
    .command("capture")
    .description("persist an unverified candidate under inbox/ without touching formal knowledge")
    .option("--source <path>", "capture into the knowledge bound to this source worktree")
    .option("--knowledge <path>", "capture into this explicit knowledge root")
    .option("--title <title>", "candidate title")
    .option("--note <note>", "provenance note stored with the candidate")
    .option("--from <file>", "read the candidate body from this file")
    .option("--body <markdown>", "candidate body text")
    .option("--source-revision <oid>", "observed source revision to record (does not imply validation)")
    .addHelpText(
      "after",
      "\ncapture writes only inbox/; it never writes docs, meta, README or the source repository, carries no verification trailer, and does not need a clean source worktree. Formal retrieval never returns candidates."
    )
    .action(async (commandOptions) => {
      const { runCapture } = await import("./commands/capture.js");
      const result = await runCapture({
        ...globalOptions,
        cwd,
        source: commandOptions.source,
        knowledge: commandOptions.knowledge,
        title: commandOptions.title,
        note: commandOptions.note,
        from: commandOptions.from,
        body: commandOptions.body,
        sourceRevision: commandOptions.sourceRevision
      });
      exitCode = result.exitCode;
      output.push(writeOutput("capture", result.output, globalOptions.json));
    });

  program
    .command("update")
    .description("review inbox candidates and prepare promotions/rejections as an unconfirmed Review Manifest")
    .option("--source <path>", "update the knowledge bound to this source worktree")
    .option("--knowledge <path>", "update this explicit knowledge root")
    .option("--promote <candidate>", "promote an inbox candidate into a canonical document")
    .option("--to <docId>", "target docs-relative .md id for --promote")
    .option("--kind <kind>", "document kind for --promote: architecture | decision | guide | reference")
    .option("--description <description>", "front matter description for --promote")
    .option("--source-path <path...>", "source evidence scope for --promote")
    .option("--requires <id...>", "requires relations for --promote")
    .option("--related <id...>", "related relations for --promote")
    .option("--supersedes <id...>", "supersedes relations for --promote")
    .option("--reject <candidate...>", "remove inbox candidates without promoting them")
    .option("--prepare", "form an unconfirmed Review Manifest from the current worktree without applying decisions")
    .option("--global", "record this as a global review scan when the manifest is sealed")
    .addHelpText(
      "after",
      "\nupdate never marks anything current: it applies explicit promote/reject decisions to the worktree and forms an unconfirmed Review Manifest. Publication still requires `review --confirm` and `commit --review`."
    )
    .action(async (commandOptions) => {
      const { runUpdate } = await import("./commands/update.js");
      const result = await runUpdate({
        ...globalOptions,
        cwd,
        source: commandOptions.source,
        knowledge: commandOptions.knowledge,
        promote: commandOptions.promote,
        to: commandOptions.to,
        kind: commandOptions.kind,
        description: commandOptions.description,
        sourcePath: commandOptions.sourcePath,
        requires: commandOptions.requires,
        related: commandOptions.related,
        supersedes: commandOptions.supersedes,
        reject: commandOptions.reject,
        prepare: commandOptions.prepare,
        global: commandOptions.global
      });
      exitCode = result.exitCode;
      output.push(writeOutput("update", result.output, globalOptions.json));
    });

  program
    .command("prune")
    .description("report conservative convergence candidates or prepare eligible removals")
    .option("--source <path>", "prune the knowledge bound to this source worktree")
    .option("--knowledge <path>", "prune this explicit knowledge root")
    .option("--report", "output the read-only convergence report")
    .option("--remove <id...>", "remove eligible documents and repair every inbound relation")
    .option("--global", "record this as a global review scan when the manifest is sealed")
    .addHelpText(
      "after",
      "\nprune only removes documents with concrete evidence (exact duplicates or superseded decisions); fragment-only candidates stay insufficient and are conservatively retained. Removal rewrites inbound relations and links, then forms an unconfirmed Review Manifest; publish with `commit --review`."
    )
    .action(async (commandOptions) => {
      const result = await runPrune({
        ...globalOptions,
        cwd,
        source: commandOptions.source,
        knowledge: commandOptions.knowledge,
        report: commandOptions.report,
        remove: commandOptions.remove,
        global: commandOptions.global
      });
      exitCode = result.exitCode;
      output.push(writeOutput("prune", result.output, globalOptions.json));
    });

  program
    .command("migrate")
    .description("explicitly migrate a legacy V3 knowledge layout into a new independent knowledge repository")
    .requiredOption("--knowledge <path>", "new external knowledge root to create")
    .option("--source <path>", "source worktree root (defaults to the current directory)")
    .option("--legacy <path>", "legacy llmdoc directory (defaults to <source>/llmdoc)")
    .option("--dry-run", "show the complete mapping, conflicts and conservative downgrades without modifying anything")
    .option("--nested", "explicitly select nested mode (the knowledge repository lives inside the source worktree)")
    .addHelpText(
      "after",
      "\nmigrate is the only command that reads V3 .mdx, CodeRef, code.paths, llmdoc/meta.json or llmdoc.config.json. It never modifies the legacy repository or the source worktree, creates a new migration baseline (no history extraction), copies only losslessly convertible documents, and writes the user binding only after the target fully validates."
    )
    .action(async (commandOptions) => {
      const { runMigrate } = await import("./commands/migrate.js");
      const result = await runMigrate({
        ...globalOptions,
        cwd,
        source: commandOptions.source,
        legacy: commandOptions.legacy,
        knowledge: commandOptions.knowledge,
        nested: commandOptions.nested,
        dryRun: commandOptions.dryRun
      });
      exitCode = result.exitCode;
      output.push(writeOutput("migrate", result.output, globalOptions.json));
    });

  program
    .command("bind")
    .description("associate a source repository with an independent knowledge repository")
    .requiredOption("--source <path>", "source worktree root")
    .requiredOption("--knowledge <path>", "knowledge repository worktree root")
    .option("--nested", "explicitly select nested mode (the knowledge repository lives inside the source worktree)")
    .addHelpText(
      "after",
      "\nPrecise binding: the knowledge repository must be an independent Git worktree with an llmdoc.yaml identity, and the association is recorded in the user registry. llmdoc never writes to the source repository."
    )
    .action(async (commandOptions) => {
      output.push(
        writeOutput(
          "bind",
          await runBind({ source: commandOptions.source, knowledge: commandOptions.knowledge, nested: commandOptions.nested }),
          globalOptions.json
        )
      );
    });

  program
    .command("init")
    .description("create an independent knowledge repository and bind it to a source repository")
    .requiredOption("--source <path>", "source worktree root")
    .requiredOption("--knowledge <path>", "new, empty target root for the knowledge repository")
    .option("--nested", "explicitly select nested mode (the knowledge repository lives inside the source worktree)")
    .addHelpText(
      "after",
      "\ninit creates the knowledge Git repository, the llmdoc layout, the initial knowledge commit and the user binding; existing non-empty targets are never overwritten and the source repository is never modified."
    )
    .action(async (commandOptions) => {
      output.push(
        writeOutput(
          "init",
          await runInit({ source: commandOptions.source, knowledge: commandOptions.knowledge, nested: commandOptions.nested }),
          globalOptions.json
        )
      );
    });

  program
    .command("hook")
    .description("fail-open SessionStart/Stop/PreCompact diagnostics over the bound knowledge protocol")
    .argument("<event>", "session-start | stop | compact")
    .option("--source <path>", "inspect the knowledge bound to this source worktree")
    .option("--knowledge <path>", "inspect this explicit knowledge root")
    .addHelpText(
      "after",
      "\nhook is read-only and fail-open: it reports review obligations and source blockers, never writes source or knowledge, never initializes a binding, and never falls back to a legacy workspace. With no binding it emits a diagnostic."
    )
    .action(async (event, commandOptions) => {
      const result = await runHook({
        cwd,
        event,
        source: commandOptions.source,
        knowledge: commandOptions.knowledge,
        json: globalOptions.json
      });
      exitCode = result.exitCode;
      if (globalOptions.json) {
        output.push(stringifyValidatedOutput("hook", result.result.payload));
      } else if (result.event === "session-start") {
        output.push(result.result.sessionStartText);
      } else {
        output.push(JSON.stringify({ continue: true, systemMessage: result.result.payload.systemMessage }));
      }
    });

  program
    .command("serve")
    .description("start the read-only knowledge viewer on 127.0.0.1 and keep running until interrupted")
    .option("--port <port>", "port to bind, 0-65535 (0 chooses a free port)", parseViewerPort)
    .option("--source <path>", "view the knowledge bound to this source worktree")
    .option("--knowledge <path>", "view this explicit knowledge root")
    .addHelpText(
      "after",
      "\nserve shows the fixed Knowledge HEAD docs with the same tri-state, source blockers and double revision as the CLI. It never displays inbox/cache as formal knowledge, never reads the legacy embedded V3 layout, and reports a diagnostic instead of initializing when no binding exists."
    )
    .action(async (commandOptions) => {
      await runServe({
        cwd,
        port: commandOptions.port,
        source: commandOptions.source,
        knowledge: commandOptions.knowledge,
        json: globalOptions.json
      });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof KnowledgeError) {
      if (globalOptions.json) {
        return {
          exitCode: error.exitCode,
          stdout: stringifyValidatedOutput("knowledgeError", {
            error: {
              code: error.code,
              message: error.message,
              paths: error.paths,
              remediation: error.remediation
            }
          })
        };
      }
      return {
        exitCode: error.exitCode,
        stdout: error.remediation ? `${error.message}\nRemediation: ${error.remediation}` : error.message
      };
    }
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout: error.message
      };
    }
    throw error;
  }

  return {
    exitCode,
    stdout: output.join("\n")
  };
}

function stringifyOutput(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function writeOutput(schemaName: OutputSchemaName, value: unknown, expectJson = false): string {
  if (expectJson) {
    return stringifyValidatedOutput(schemaName, value);
  }
  return stringifyOutput(value);
}

function parseInteger(input: string): number {
  const value = Number.parseInt(input, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new CliError(`Invalid integer: ${input}`);
  }
  return value;
}

function readPackageVersion(): string {
  const packageRoot = packageRootFromImport(import.meta.url);
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version: string };
  return packageJson.version;
}

function parseGlobalOptions(argv: string[]): { json?: boolean; cursor?: string; budget?: number; limit?: number } {
  const options: { json?: boolean; cursor?: string; budget?: number; limit?: number } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      options.json = true;
    } else if (token === "--cursor" && argv[index + 1]) {
      options.cursor = argv[index + 1];
      index += 1;
    } else if (token === "--budget" && argv[index + 1]) {
      options.budget = parseInteger(argv[index + 1]!);
      index += 1;
    } else if (token === "--limit" && argv[index + 1]) {
      options.limit = parseInteger(argv[index + 1]!);
      index += 1;
    }
  }
  return options;
}
