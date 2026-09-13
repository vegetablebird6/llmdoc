#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stale = ["@tokenroll/llmdoc", "TokenRollAI/llmdoc"];
const files = [...walk(path.join(root, "src")), ...walk(path.join(root, "public"))].filter((file) => /\.(astro|txt)$/.test(file));
const failures = files.flatMap((file) =>
  stale.filter((value) => fs.readFileSync(file, "utf8").includes(value)).map((value) => `${path.relative(root, file)}: ${value}`)
);

if (failures.length > 0) {
  process.stderr.write(`Stale distribution links:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
