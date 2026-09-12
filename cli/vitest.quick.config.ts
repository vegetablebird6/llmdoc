import { defineConfig } from "vitest/config";

import { sharedTestConfig } from "./vitest.config.js";

export default defineConfig({
  test: {
    ...sharedTestConfig,
    testTimeout: 120000,
    include: [
      "tests/search-cjk.test.ts",
      "tests/runtime-surface.test.ts",
      "tests/cli-output-schema.test.ts",
      "tests/knowledge-config-schema.test.ts",
      "tests/knowledge-lock.test.ts",
      "tests/knowledge-registry.test.ts",
      "tests/cli-misc.test.ts",
      "tests/knowledge-content.test.ts",
      "tests/knowledge-cli.test.ts",
      "tests/knowledge-hook.test.ts",
      "tests/knowledge-viewer.test.ts",
      "tests/knowledge-contexts.test.ts"
    ]
  }
});
