import { defineConfig } from "vitest/config";

export const sharedTestConfig = {
  environment: "node" as const,
  // Parallel file execution multiplies Git process spawns on this host and makes
  // every Git-spawning test 4-6x slower, which both blows per-test budgets and
  // starves the worker RPC deadline. Serial file execution keeps the suite
  // deterministic.
  fileParallelism: false,
  // Integration tests execute real Git transactions; Windows process startup and
  // antivirus scanning can push the same passing case from seconds to minutes.
  testTimeout: 300000
};

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ["tests/**/*.test.ts"]
  }
});
