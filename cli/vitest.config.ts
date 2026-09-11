import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // v3-ng scheduling fix (R8): parallel file execution slows every Git-spawning
    // test 4-6x on this host, which both blows the 5s default test timeout and
    // keeps workers from serving the 60s birpc onTaskUpdate deadline.
    // Serial file execution keeps the whole suite deterministic.
    fileParallelism: false,
    // R8 runner configuration: several Git-heavy tests (V3 cli/cold-start suites)
    // legitimately run 5-20s on slow/AV-scanned hosts even when serial, so the
    // 5s default makes `npm test` flaky here. 30s bounds runaway cases without
    // masking real failures.
    testTimeout: 30000
  }
});
