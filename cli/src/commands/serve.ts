import http from "node:http";
import type { AddressInfo } from "node:net";

import { KnowledgeError } from "../lib/knowledge/errors.js";
import { assertOutputSchema } from "../lib/output-schema.js";
import { createKnowledgeViewerRequestHandler, type KnowledgeViewerOptions } from "../lib/knowledge/viewer-http.js";

export interface KnowledgeViewerServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export interface ServeOptions extends KnowledgeViewerOptions {
  port?: number;
  json?: boolean;
}

export interface ServeRuntime {
  stdout?: { write: (chunk: string) => unknown };
  signal?: AbortSignal;
}

const MIN_PORT = 0;
const MAX_PORT = 65535;

function invalidPort(value: unknown): KnowledgeError {
  return new KnowledgeError("E_INVALID_PORT", `Invalid viewer port: ${value}`, {
    paths: [String(value)],
    remediation: `Choose an integer port between ${MIN_PORT} and ${MAX_PORT}; 0 selects a free port.`
  });
}

export function assertViewerPort(port: number | undefined): void {
  if (port === undefined) {
    return;
  }
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw invalidPort(port);
  }
}

/** Parses a `--port` string so malformed, non-integer and out-of-range values all fail as `E_INVALID_PORT`. */
export function parseViewerPort(input: string): number {
  const trimmed = input.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw invalidPort(input);
  }
  const value = Number.parseInt(trimmed, 10);
  assertViewerPort(value);
  return value;
}

/** Serializable start notification; the JSON form is a single schema-valid line so stdout capture stays safe. */
export function formatServeStart(options: { json?: boolean }, server: { port: number; url: string }): string {
  if (options.json) {
    const payload = { schema: "llmdoc.serve/v1", url: server.url, port: server.port } as const;
    assertOutputSchema("serve", payload);
    return JSON.stringify(payload);
  }
  return `llmdoc viewer: ${server.url}  (press Ctrl-C to stop)`;
}

/**
 * Starts the read-only viewer. It binds to 127.0.0.1 only, never writes source or
 * knowledge, and reports a diagnostic state instead of initializing anything when no
 * binding is available.
 */
export function startKnowledgeViewerServer(options: ServeOptions): Promise<KnowledgeViewerServer> {
  assertViewerPort(options.port);
  const handler = createKnowledgeViewerRequestHandler(options);
  const server = http.createServer(handler);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closed, closeRejected) => {
            server.close((error) => (error ? closeRejected(error) : closed()));
          })
      });
    });
  });
}

/**
 * Foreground serve: emits the registered `llmdoc.serve/v1` start notification (or a
 * coherent text line) to the runtime stdout and then keeps the server alive until SIGINT,
 * SIGTERM or the supplied abort signal. The notification is written before the first
 * request can arrive so stdout capture never blocks the server.
 */
export async function runServe(options: ServeOptions, runtime: ServeRuntime = {}): Promise<void> {
  const server = await startKnowledgeViewerServer(options);
  const sink = runtime.stdout ?? process.stdout;
  sink.write(`${formatServeStart(options, server)}\n`);
  await waitForShutdown(server, runtime.signal);
}

function waitForShutdown(server: KnowledgeViewerServer, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      signal?.removeEventListener("abort", onSignal);
    };
    const onSignal = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      server.close().then(resolve, reject);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    if (signal !== undefined) {
      if (signal.aborted) {
        onSignal();
      } else {
        signal.addEventListener("abort", onSignal, { once: true });
      }
    }
  });
}
