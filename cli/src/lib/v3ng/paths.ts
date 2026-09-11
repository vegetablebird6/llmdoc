import fs from "node:fs";
import path from "node:path";

export function realPath(input: string): string {
  return fs.realpathSync(path.resolve(input));
}

export function realPathViaExistingAncestor(input: string): string {
  const absolute = path.resolve(input);
  const missing: string[] = [];
  let current = absolute;
  while (true) {
    let resolved: string;
    try {
      resolved = fs.realpathSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing.unshift(path.basename(current));
        const parent = path.dirname(current);
        if (parent === current) {
          throw error;
        }
        current = parent;
        continue;
      }
      throw error;
    }
    let result = resolved;
    for (const segment of missing) {
      result = path.join(result, segment);
    }
    return result;
  }
}

export function sameRealPath(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right);
}

export function isWithinRootReal(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForCompare(root);
  const normalizedCandidate = normalizeForCompare(candidate);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function normalizeForCompare(input: string): string {
  const normalized = path.normalize(input);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
