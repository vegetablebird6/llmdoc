import path from "node:path";

const LINK_PATTERN = /(?<!!)\[[^\]]*]\(([^)]+)\)/g;
const CODE_REF_PATTERN = /<CodeRef\b([\s\S]*?)\/>/g;
const INLINE_CODE_PATTERN = /`[^`\n]*`/g;

export function extractTitle(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function extractLinks(body: string): string[] {
  const text = stripMarkdownLiterals(body);
  const links: string[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget) {
      continue;
    }
    if (
      rawTarget.startsWith("http://") ||
      rawTarget.startsWith("https://") ||
      rawTarget.startsWith("mailto:") ||
      rawTarget.startsWith("#")
    ) {
      continue;
    }
    const targetWithoutAnchor = rawTarget.split("#")[0] ?? rawTarget;
    const targetWithoutQuery = targetWithoutAnchor.split("?")[0] ?? targetWithoutAnchor;
    if (targetWithoutQuery) {
      links.push(targetWithoutQuery);
    }
  }
  return links;
}

/** Migrate-only: extracts legacy `<CodeRef />` evidence scope while importing a V3 layout. */
export function extractCodeRefs(body: string): { path: string; symbol?: string }[] {
  const text = stripMarkdownLiterals(body);
  const refs: { path: string; symbol?: string }[] = [];
  for (const match of text.matchAll(CODE_REF_PATTERN)) {
    const attributes = parseCodeRefAttributes(match[1] ?? "");
    const codePath = attributes.path?.trim();
    if (!codePath) {
      continue;
    }
    refs.push({
      path: codePath,
      symbol: attributes.symbol?.trim() || undefined
    });
  }
  return refs;
}

export function resolveDocLink(sourceLlmdocPath: string, linkTarget: string): string {
  const sourceDir = path.posix.dirname(sourceLlmdocPath);
  return path.posix.normalize(path.posix.join(sourceDir, linkTarget));
}

export function stripFencedCodeBlocks(input: string): string {
  return input.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

export function stripMarkdownLiterals(input: string): string {
  return stripFencedCodeBlocks(input).replace(INLINE_CODE_PATTERN, "");
}

function parseCodeRefAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of input.matchAll(/([A-Za-z]+)="([^"]*)"/g)) {
    attributes[match[1]!] = match[2] ?? "";
  }
  return attributes;
}
