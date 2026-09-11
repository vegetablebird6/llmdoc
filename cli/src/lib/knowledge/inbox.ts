import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { contentDigest, normalizeKnowledgeContent } from "./document.js";
import { KnowledgeError } from "./errors.js";
import { listTreeFiles, readGitBlobs } from "./git-core.js";
import type { KnowledgeWriteContext } from "./write-context.js";

/**
 * Minimal inbox candidate model. Candidates are unverified, first-class-but-excluded
 * knowledge: they live under `inbox/` as plain Markdown, are committed only by capture,
 * and never enter the formal `docs/**` knowledge surface or its validity model.
 */

export const INBOX_DIRNAME = "inbox";
export const INBOX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

export interface InboxCandidate {
  /** inbox-relative POSIX path, e.g. "2026...-retry.md"; the candidate ID. */
  id: string;
  title: string | null;
  capturedAt: string | null;
  sourceRevision: string | null;
  note: string | null;
  body: string;
  raw: string;
  contentDigest: string;
}

export function isInboxCandidateId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("/")) {
    return false;
  }
  if (value.includes("..") || value.startsWith(".")) {
    return false;
  }
  return INBOX_ID_PATTERN.test(value);
}

export function inboxRepoPath(id: string): string {
  return `${INBOX_DIRNAME}/${id}`;
}

export function generateCandidateId(title: string | null, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const slug =
    (title ?? "candidate")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "candidate";
  const salt = Math.random().toString(16).slice(2, 8);
  return `${stamp}-${slug}-${salt}.md`;
}

export interface BuildCandidateInput {
  title?: string;
  note?: string;
  sourceRevision?: string | null;
  body: string;
  now?: Date;
}

/** Serializes a candidate as plain Markdown with a small, non-evidentiary front matter. */
export function buildCandidateContent(input: BuildCandidateInput): string {
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(input.title ?? "Untitled candidate")}`,
    `capturedAt: ${JSON.stringify((input.now ?? new Date()).toISOString())}`,
    `sourceRevision: ${input.sourceRevision ? JSON.stringify(input.sourceRevision) : "null"}`,
    `note: ${JSON.stringify(input.note ?? "")}`,
    "---",
    ""
  ];
  return `${frontmatter.join("\n")}${normalizeKnowledgeContent(input.body)}\n`;
}

export function parseInboxCandidate(id: string, raw: string): InboxCandidate {
  if (!isInboxCandidateId(id)) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Invalid inbox candidate id: ${id}`, { paths: [id] });
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Candidate front matter parse failed for ${id}: ${(error as Error).message}`, {
      paths: [id]
    });
  }
  const data = parsed.data as Record<string, unknown>;
  return {
    id,
    title: typeof data.title === "string" ? data.title : null,
    capturedAt: typeof data.capturedAt === "string" ? data.capturedAt : null,
    sourceRevision: typeof data.sourceRevision === "string" ? data.sourceRevision : null,
    note: typeof data.note === "string" ? data.note : null,
    body: parsed.content,
    raw,
    contentDigest: contentDigest(raw)
  };
}

/** Committed inbox candidate ids at the fixed knowledge revision K0. */
export async function listCommittedInboxIds(context: KnowledgeWriteContext): Promise<string[]> {
  const k0 = context.knowledgeHead;
  if (k0 === null) {
    return [];
  }
  const files = await listTreeFiles(context.knowledgeGit, k0, INBOX_DIRNAME);
  return files
    .filter((file) => file.startsWith(`${INBOX_DIRNAME}/`))
    .map((file) => file.slice(INBOX_DIRNAME.length + 1))
    .filter((id) => isInboxCandidateId(id))
    .sort();
}

/** Worktree inbox candidate ids (drafts included); symlinks and non-.md files are ignored. */
export function listWorktreeInboxIds(knowledgeRoot: string): string[] {
  const directory = path.join(knowledgeRoot, INBOX_DIRNAME);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    // Only a genuinely missing inbox directory is an empty inbox. A permission error,
    // transient I/O failure or a non-directory path must never be mistaken for "no
    // candidates": that could hide committed candidates from promotion/rejection.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw new KnowledgeError("E_FILESYSTEM_IO", `Failed to read the inbox directory: ${(error as Error).message}`, {
      exitCode: 70,
      paths: [directory],
      remediation: "Check that the inbox path is a readable directory; llmdoc reports filesystem failures instead of assuming an empty inbox."
    });
  }
  return entries
    .filter((entry) => entry.isFile() && isInboxCandidateId(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Candidate ids physically removed from the worktree relative to K0 (promotion/rejection). */
export async function computeCandidateRemovals(context: KnowledgeWriteContext): Promise<string[]> {
  const committed = new Set(await listCommittedInboxIds(context));
  const worktree = new Set(listWorktreeInboxIds(context.knowledge.worktreeRoot));
  return [...committed].filter((id) => !worktree.has(id)).sort();
}

export async function readCommittedCandidates(context: KnowledgeWriteContext): Promise<InboxCandidate[]> {
  const ids = await listCommittedInboxIds(context);
  if (ids.length === 0 || context.knowledgeHead === null) {
    return [];
  }
  const blobs = await readGitBlobs(
    context.knowledgeGit,
    context.knowledgeHead,
    ids.map((id) => inboxRepoPath(id))
  );
  const candidates: InboxCandidate[] = [];
  for (const id of ids) {
    const raw = blobs.get(inboxRepoPath(id));
    if (raw === undefined) {
      continue;
    }
    candidates.push(parseInboxCandidate(id, raw));
  }
  return candidates;
}

export function readWorktreeCandidate(knowledgeRoot: string, id: string): InboxCandidate {
  if (!isInboxCandidateId(id)) {
    throw new KnowledgeError("E_DOCUMENT_INVALID", `Invalid inbox candidate id: ${id}`, { paths: [id] });
  }
  const filePath = path.join(knowledgeRoot, INBOX_DIRNAME, id);
  if (!fs.existsSync(filePath)) {
    throw new KnowledgeError("E_KNOWLEDGE_DOC_NOT_FOUND", `Inbox candidate does not exist: ${id}`, { paths: [filePath] });
  }
  return parseInboxCandidate(id, fs.readFileSync(filePath, "utf8"));
}
