#!/usr/bin/env node
// Plugin-side launcher for llmdoc lifecycle hooks.
//
// The host invokes this file instead of npx directly so hooks stay fail-open even
// when the scoped CLI cannot be installed, resolved, spawned or finishes in time.
// A normal launch forwards the child's stdout/stderr bytes unchanged and adopts
// its exit code. A failed launch emits a concise diagnostic and exits 0:
//   SessionStart        plain text
//   Stop / PreCompact   {"continue":true,"systemMessage":...}
//
// The scoped alias is still used so a same-name local `file:` dependency without a
// built bin cannot shadow the hook runtime.
import { spawnSync } from "node:child_process";

const SCOPED_PACKAGE = "@vegetablebird6/llmdoc-hook-runtime@npm:@vegetablebird6/llmdoc";
const LAUNCH_TIMEOUT_MS = 60_000;
const KNOWN_EVENTS = new Set(["session-start", "stop", "compact"]);

const requestedEvent = process.argv[2] ?? "";

if (!KNOWN_EVENTS.has(requestedEvent)) {
  emitFailOpen("stop", `unknown hook event: ${requestedEvent || "<missing>"}`);
} else {
  // Single safe command string (fixed tokens only) avoids shell args escaping issues
  // on Windows and Linux and keeps the scoped alias un-shadowable.
  const launchCommand = ["npx", "-y", `--package=${SCOPED_PACKAGE}`, "--", "llmdoc", "hook", requestedEvent].join(" ");
  const result = spawnSync(launchCommand, {
    shell: true,
    stdio: ["inherit", "pipe", "pipe"],
    timeout: LAUNCH_TIMEOUT_MS
  });

  if (!result.error && result.status === 0) {
    if (result.stdout && result.stdout.length > 0) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr && result.stderr.length > 0) {
      process.stderr.write(result.stderr);
    }
    process.exitCode = 0;
  } else {
    emitFailOpen(requestedEvent, describeFailure(result));
  }
}

function describeFailure(result) {
  if (result.error) {
    return result.error.code ? String(result.error.code) : result.error.message;
  }
  if (result.signal) {
    return `launch ${result.signal}`;
  }
  if (typeof result.status === "number") {
    return `launch exited ${result.status}`;
  }
  return "launch failed";
}

function emitFailOpen(event, reason) {
  const message = `llmdoc hook runtime unavailable (${reason})`;
  if (event === "session-start") {
    process.stdout.write(`llmdoc: ${message}. Retrieval and native tools remain available.\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ continue: true, systemMessage: `${message}; continuing.` })}\n`);
  }
  process.exitCode = 0;
}
