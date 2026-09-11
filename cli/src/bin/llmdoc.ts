#!/usr/bin/env node

import { runCli } from "../cli.js";

try {
  const result = await runCli(process.argv.slice(2), process.cwd());
  if (result.stdout) {
    process.stdout.write(`${result.stdout}\n`);
  }
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`llmdoc: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(70);
}
