import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { createFixture, writeRepoFile } from "./helpers.js";

const PACKAGE_VERSION = (JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")) as { version: string }).version;

describe("llmdoc cli", () => {
  test("prune report and upgrade inventory stay read-only and deterministic", async () => {
    const rootDir = createFixture();
    const prune = await runCli(["prune", "--report", "--json"], rootDir);
    const pruneJson = JSON.parse(prune.stdout) as {
      status: string;
      writable: boolean;
      growth: { currentDocumentCount: number };
      startupPreloads: string[];
      mergeCandidates: unknown[];
    };
    expect(pruneJson.status).toBe("dry_run");
    expect(pruneJson.writable).toBe(false);
    expect(pruneJson.growth.currentDocumentCount).toBeGreaterThan(0);
    expect(pruneJson.startupPreloads).toEqual([]);
    expect(Array.isArray(pruneJson.mergeCandidates)).toBe(true);

    writeRepoFile(
      rootDir,
      "llmdoc.config.json",
      `${JSON.stringify(
        { schema: "llmdoc.config/v1", startup: { preload: ["api-client/error-model.mdx"] } },
        null,
        2
      )}\n`
    );
    const configuredPrune = await runCli(["prune", "--report"], rootDir);
    expect(configuredPrune.stdout).toContain("startup preload references:");
    expect(configuredPrune.stdout).toContain("llmdoc/api-client/error-model.mdx");
    expect(configuredPrune.stdout).toContain("Keep llmdoc.config.json synchronized");

    const v3Upgrade = await runCli(["upgrade", "--json"], rootDir);
    const v3UpgradeJson = JSON.parse(v3Upgrade.stdout) as { status: string; requiresRecorderSemanticMigration: boolean };
    expect(v3UpgradeJson.status).toBe("no_change");
    expect(v3UpgradeJson.requiresRecorderSemanticMigration).toBe(false);

    const legacyRoot = createFixture({ broken: "legacy-v2" });
    const legacyUpgrade = await runCli(["upgrade", "--json"], legacyRoot);
    const legacyUpgradeJson = JSON.parse(legacyUpgrade.stdout) as {
      status: string;
      legacyPaths: string[];
      requiresRecorderSemanticMigration: boolean;
    };
    expect(legacyUpgradeJson.status).toBe("dry_run");
    expect(legacyUpgradeJson.legacyPaths).toContain("index.md");
    expect(legacyUpgradeJson.legacyPaths).toContain("state/sync.md");
    expect(legacyUpgradeJson.requiresRecorderSemanticMigration).toBe(true);

    const invalidV3Root = createFixture();
    writeRepoFile(invalidV3Root, "llmdoc/bad-root.mdx", "---\ndescription: bad\nkind: bogus\n---\n\n# Bad\n");
    const invalidV3Upgrade = await runCli(["upgrade", "--json"], invalidV3Root);
    const invalidV3Json = JSON.parse(invalidV3Upgrade.stdout) as { status: string };
    expect(invalidV3Json.status).toBe("dry_run");
  });

  test("installed file dependency exposes executable node_modules/.bin/llmdoc", async () => {
    const packageDir = path.resolve(__dirname, "..");
    const consumerDir = fs.mkdtempSync(path.join(process.cwd(), "llmdoc-consumer-"));
    try {
      const { spawnSync } = await import("node:child_process");
      spawnSync("npm", ["init", "-y"], { cwd: consumerDir, encoding: "utf8", shell: process.platform === "win32" });
      const packageJsonPath = path.join(consumerDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      packageJson.dependencies = {
        ...(packageJson.dependencies ?? {}),
        "@tokenroll/llmdoc": `file:${packageDir}`
      };
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
      const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
        cwd: consumerDir,
        encoding: "utf8",
        shell: process.platform === "win32",
        env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: "false" }
      });
      expect(install.status).toBe(0);
      const binPath = path.join(consumerDir, "node_modules", ".bin", "llmdoc");
      expect(fs.existsSync(binPath)).toBe(true);
      if (process.platform !== "win32") {
        const mode = fs.statSync(binPath).mode & 0o111;
        expect(mode).not.toBe(0);
      }
      const installedPackageJson = JSON.parse(fs.readFileSync(path.join(consumerDir, "node_modules", "@tokenroll/llmdoc", "package.json"), "utf8")) as {
        version: string;
      };
      expect(installedPackageJson.version).toBe(PACKAGE_VERSION);
      const result = spawnSync(
        process.platform === "win32" ? `${binPath}.cmd` : binPath,
        ["--help"],
        { cwd: consumerDir, encoding: "utf8", shell: process.platform === "win32" }
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: llmdoc");
      expect(result.stdout).toContain("Quick reference by purpose");
      expect(result.stdout).not.toMatch(/[\p{Script=Han}]/u);
    } finally {
      fs.rmSync(consumerDir, { recursive: true, force: true });
    }
  });

  test("version/help and lint surface are publishable", async () => {
    const rootDir = createFixture();
    const version = await runCli(["--version"], rootDir);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).toBe(PACKAGE_VERSION);

  });

  test("viewer server serves app shell, state, and doc detail", { timeout: 20000 }, async () => {
    const rootDir = createFixture();
    const { startViewerServer } = await import("../src/commands/serve.js");
    const server = await startViewerServer(rootDir, 0);
    try {
      const home = await fetch(`${server.url}/`);
      expect(home.status).toBe(200);
      expect(await home.text()).toContain("llmdoc viewer");

      const stateResponse = await fetch(`${server.url}/api/state`);
      expect(stateResponse.status).toBe(200);
      const state = (await stateResponse.json()) as {
        nodes: { path: string; status: string; topic: string | null }[];
        edges: { from: string; to: string; type: string }[];
        validate: { ok: boolean };
        baseline: { revision: string | null };
      };
      expect(state.validate.ok).toBe(true);
      expect(state.baseline.revision).toBeTruthy();
      expect(state.nodes.some((node) => node.path === "api-client/retry-policy.mdx")).toBe(true);
      // requires 边 + index.mdx 正文链接边都要进图
      expect(state.edges.some((edge) => edge.from === "api-client/retry-policy.mdx" && edge.to === "api-client/error-model.mdx" && edge.type === "requires")).toBe(true);
      expect(state.edges.some((edge) => edge.from === "api-client/overview.mdx" && edge.to === "api-client/retry-policy.mdx")).toBe(true);

      const docResponse = await fetch(`${server.url}/api/doc?path=${encodeURIComponent("api-client/retry-policy.mdx")}`);
      expect(docResponse.status).toBe(200);
      const doc = (await docResponse.json()) as { frontmatter: { kind: string }; body: string };
      expect(doc.frontmatter.kind).toBe("guide");
      expect(doc.body).toContain("CodeRef");

      const missing = await fetch(`${server.url}/api/doc?path=${encodeURIComponent("../../etc/passwd")}`);
      expect(missing.status).toBe(404);

      const markedAsset = await fetch(`${server.url}/assets/marked.js`);
      expect(markedAsset.status).toBe(200);
      expect((await markedAsset.text()).length).toBeGreaterThan(100);
    } finally {
      await server.close();
    }
  });
});
