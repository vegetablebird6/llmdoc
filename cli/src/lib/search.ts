import { Minimatch } from "minimatch";

export function matchesCodePathPattern(pattern: string, repoRelativePath: string): boolean {
  const normalizedPattern = normalizeCodePathPattern(pattern);
  if (normalizedPattern === repoRelativePath) {
    return true;
  }
  if (!/[*?[\]{}]/.test(normalizedPattern)) {
    return false;
  }
  return new Minimatch(normalizedPattern, { dot: true, nocase: false }).match(repoRelativePath);
}

function normalizeCodePathPattern(pattern: string): string {
  let normalized = pattern.replaceAll("\\", "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized.replace(/\/+$/, "");
}

const WORD_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });
const CJK_CHARACTER = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/gu;
const QUERY_STOP_WORDS = new Set([
  "的",
  "了",
  "呢",
  "吗",
  "啊",
  "吧",
  "是",
  "在",
  "与",
  "和",
  "或",
  "及",
  "把",
  "被",
  "从",
  "到",
  "为",
  "怎么",
  "如何",
  "什么",
  "为何"
]);

export function tokenizeQuery(input: string): string[] {
  const tokens: string[] = [];
  let singleCjkBuffer: string[] = [];
  const flushSingleCjkBuffer = (): void => {
    if (singleCjkBuffer.length > 0) {
      tokens.push(singleCjkBuffer.join(""));
      singleCjkBuffer = [];
    }
  };

  for (const part of WORD_SEGMENTER.segment(input.toLowerCase())) {
    const value = part.segment.trim();
    if (!part.isWordLike || !value) {
      flushSingleCjkBuffer();
      continue;
    }
    if (QUERY_STOP_WORDS.has(value)) {
      flushSingleCjkBuffer();
      continue;
    }
    if (CJK_CHARACTER.test(value)) {
      singleCjkBuffer.push(value);
      continue;
    }
    flushSingleCjkBuffer();
    tokens.push(value);
  }
  flushSingleCjkBuffer();
  return unique(tokens);
}

export function cjkBigrams(input: string): string[] {
  const bigrams: string[] = [];
  for (const match of input.toLowerCase().matchAll(CJK_RUN)) {
    const characters = [...match[0]];
    for (let index = 0; index < characters.length - 1; index += 1) {
      bigrams.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return unique(bigrams);
}

export function countWords(input: string): number {
  let count = 0;
  for (const part of WORD_SEGMENTER.segment(input)) {
    if (part.isWordLike && part.segment.trim()) {
      count += 1;
    }
  }
  return count || 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildSnippet(body: string, tokens: string[]): string {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const loweredTokens = tokens.map((token) => token.toLowerCase());
  const line =
    lines.find((candidate) => loweredTokens.some((token) => candidate.toLowerCase().includes(token))) ??
    lines[0] ??
    "";
  return line.slice(0, 180);
}

export function countSubstring(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + needle.length;
  }
  return count;
}
