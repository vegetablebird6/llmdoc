import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

import { packageRootFromImport } from "../package-root.js";
import { KnowledgeError } from "./errors.js";
import { relationsFor } from "./knowledge-model.js";
import { loadKnowledgeForRead, type LoadedKnowledge } from "./read.js";
import { projectKnowledgeViewerState } from "./viewer-state.js";

interface StaticAsset {
  fileName: string;
  contentType: string;
}

const STATIC_ASSETS: ReadonlyMap<string, StaticAsset> = new Map([
  ["/", { fileName: "viewer.html", contentType: "text/html; charset=utf-8" }],
  ["/assets/viewer.css", { fileName: "viewer.css", contentType: "text/css; charset=utf-8" }],
  ["/assets/viewer-model.js", { fileName: "viewer-model.js", contentType: "text/javascript; charset=utf-8" }],
  ["/assets/viewer-graph.js", { fileName: "viewer-graph.js", contentType: "text/javascript; charset=utf-8" }],
  ["/assets/viewer-detail.js", { fileName: "viewer-detail.js", contentType: "text/javascript; charset=utf-8" }],
  ["/assets/viewer-app.js", { fileName: "viewer-app.js", contentType: "text/javascript; charset=utf-8" }]
]);

export interface KnowledgeViewerOptions {
  cwd: string;
  source?: string;
  knowledge?: string;
  registryDir?: string;
}

export type ViewerRequestHandler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

/**
 * Read-only viewer handler over the knowledge protocol. It serves only the fixed
 * Knowledge HEAD docs plus the same tri-state / source-blocker / double-revision projection
 * used by the CLI. Missing bindings produce a diagnostic payload; the viewer never
 * initializes Git, never writes source or knowledge, and never falls back to legacy V3.
 */
export function createKnowledgeViewerRequestHandler(options: KnowledgeViewerOptions): ViewerRequestHandler {
  const packageRoot = packageRootFromImport(import.meta.url);
  const assetsRoot = path.join(packageRoot, "assets");

  return (request, response): void => {
    void handleRequest(request, response, assetsRoot, options);
  };
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  assetsRoot: string,
  options: KnowledgeViewerOptions
): Promise<void> {
  const headOnly = request.method === "HEAD";
  try {
    if (request.method !== "GET" && !headOnly) {
      sendJson(response, 405, { error: "method not allowed" }, headOnly, { allow: "GET, HEAD" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const staticAsset = STATIC_ASSETS.get(url.pathname);
    if (staticAsset) {
      sendStaticAsset(response, assetsRoot, staticAsset, headOnly);
      return;
    }
    if (url.pathname === "/assets/marked.js") {
      sendMarked(response, headOnly);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      sendBody(response, 204, Buffer.alloc(0), "image/x-icon", headOnly);
      return;
    }
    if (url.pathname === "/api/state") {
      sendJson(response, 200, await buildState(options), headOnly);
      return;
    }
    if (url.pathname === "/api/doc") {
      const documentId = url.searchParams.get("path") ?? "";
      const lookup = await buildDocument(options, documentId);
      sendJson(response, lookup.status, lookup.payload, headOnly);
      return;
    }
    sendJson(response, 404, { error: "not found" }, headOnly);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message }, headOnly);
  }
}

async function buildState(options: KnowledgeViewerOptions): Promise<Record<string, unknown>> {
  try {
    const loaded = await loadKnowledgeForRead({
      cwd: options.cwd,
      sourceInput: options.source,
      knowledgeInput: options.knowledge,
      registryDir: options.registryDir
    });
    return { schema: "llmdoc.viewer-state/v1", ...projectKnowledgeViewerState(loaded) };
  } catch (error) {
    return diagnosticState(error);
  }
}

interface DocumentLookup {
  status: number;
  payload: Record<string, unknown>;
}

/**
 * Resolves one formal document from the fixed Knowledge snapshot. Missing, non-formal,
 * inbox and cache ids are indistinguishable from the client's perspective: every failure
 * is an HTTP 404 with the same byte-stable body, and formal docs only ever come from the
 * committed `docs/**` tree of the fixed Knowledge HEAD (or the unbound docs directory).
 */
async function buildDocument(options: KnowledgeViewerOptions, documentId: string): Promise<DocumentLookup> {
  let loaded: LoadedKnowledge;
  try {
    loaded = await loadKnowledgeForRead({
      cwd: options.cwd,
      sourceInput: options.source,
      knowledgeInput: options.knowledge,
      registryDir: options.registryDir
    });
  } catch {
    return { status: 404, payload: notFoundDocument(documentId) };
  }
  const document = loaded.model.byId.get(documentId);
  if (!document) {
    return { status: 404, payload: notFoundDocument(documentId) };
  }
  const validity = loaded.validity.byId.get(document.id);
  const relations = relationsFor(loaded.model, document.id);
  return {
    status: 200,
    payload: {
      schema: "llmdoc.viewer-doc/v1",
      id: document.id,
      kind: document.frontmatter.kind,
      title: document.title,
      description: document.frontmatter.description,
      topic: document.topic,
      status: validity?.status ?? "unverified",
      reasons: validity?.reasons ?? [],
      sourcePaths: [...document.frontmatter.source.paths],
      requires: [...relations.requires],
      related: [...relations.related],
      supersedes: [...relations.supersedes],
      supersededBy: loaded.model.supersededBy.get(document.id) ?? [],
      body: document.body,
      estimatedTokens: document.estimatedTokens,
      lineCount: document.lineCount
    }
  };
}

function notFoundDocument(documentId: string): Record<string, unknown> {
  return { schema: "llmdoc.viewer-doc/v1", error: "document_not_found", documentId };
}

function diagnosticState(error: unknown): Record<string, unknown> {
  const detail = error instanceof KnowledgeError
    ? { code: error.code, message: error.message, remediation: error.remediation }
    : { code: "E_VIEWER_UNAVAILABLE", message: error instanceof Error ? error.message : String(error), remediation: "" };
  return {
    schema: "llmdoc.viewer-state/v1",
    mode: "diagnostic",
    repository: null,
    repositoryId: null,
    sourceRevision: null,
    knowledgeRevision: null,
    lastGlobalReviewRevision: null,
    sourceBlockers: [],
    historyAvailable: false,
    nodes: [],
    edges: [],
    issues: [],
    diagnostic: detail
  };
}

function sendStaticAsset(
  response: http.ServerResponse,
  assetsRoot: string,
  asset: StaticAsset,
  headOnly: boolean
): void {
  const assetPath = path.join(assetsRoot, asset.fileName);
  if (!fs.existsSync(assetPath)) {
    throw new KnowledgeError("E_FILESYSTEM_IO", `Viewer asset is missing: ${asset.fileName}`, { exitCode: 70, paths: [assetPath] });
  }
  sendBody(response, 200, fs.readFileSync(assetPath), asset.contentType, headOnly);
}

function sendMarked(response: http.ServerResponse, headOnly: boolean): void {
  try {
    const require = createRequire(import.meta.url);
    const markedPath = require.resolve("marked/marked.min.js");
    sendBody(response, 200, fs.readFileSync(markedPath), "text/javascript; charset=utf-8", headOnly);
  } catch {
    const fallback =
      "window.marked={parse:(text)=>'<pre>'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>'};";
    sendBody(response, 200, Buffer.from(fallback), "text/javascript; charset=utf-8", headOnly);
  }
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  headOnly: boolean,
  extraHeaders: Record<string, string> = {}
): void {
  sendBody(response, statusCode, Buffer.from(JSON.stringify(payload)), "application/json; charset=utf-8", headOnly, extraHeaders);
}

function sendBody(
  response: http.ServerResponse,
  statusCode: number,
  body: Buffer,
  contentType: string,
  headOnly: boolean,
  extraHeaders: Record<string, string> = {}
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' http: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extraHeaders
  });
  response.end(headOnly ? undefined : body);
}
