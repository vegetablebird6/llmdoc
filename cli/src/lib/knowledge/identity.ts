import { randomBytes } from "node:crypto";

export const REPOSITORY_ID_PATTERN = /^llmdoc-[0-9a-f]{32}$/;

export function generateRepositoryId(): string {
  return `llmdoc-${randomBytes(16).toString("hex")}`;
}

export function isRepositoryId(input: unknown): input is string {
  return typeof input === "string" && REPOSITORY_ID_PATTERN.test(input);
}
