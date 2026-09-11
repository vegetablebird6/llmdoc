import { defineConfig } from "vitest/config";

export const sharedTestConfig = {
  environment: "node" as const,
  // Parallel file execution multiplies Git process spawns on this host and makes
  // every Git-spawning test 4-6x slower, which both blows per-test budgets and
  // starves the worker RPC deadline. Serial file execution keeps the suite
  // deterministic.
  fileParallelism: false,
  // Baseline per-test budget. Git-heavy files opt into a larger explicit budget
  // with `vi.setConfig` where a full init/review/seal transaction demonstrably
  // exceeds this value on a slow/AV-scanned host.
  testTimeout: 30000
};

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ["tests/**/*.test.ts"]
  }
});
