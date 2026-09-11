import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 120000 });

import { runCli } from "../src/cli.js";
import { commitFile, initRepo, makeTempDir } from "./knowledge-helpers.js";

const PACKAGE_VERSION = (JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")) as { version: string }).version;

describe("llmdoc cli", () => {
  test("maintenance commands are protocol-scoped: prune fails closed without a binding", async () => {
    const source = initRepo(path.join(makeTempDir("llmdoc-misc-"), "source"));
    commitFile(source, "a.ts", "export const a = 1;\n", "init");
    const prune = await runCli(["prune", "--report", "--json"], source);
    const pruneJson = JSON.parse(prune.stdout) as { error?: { code: string } };
    expect(prune.exitCode).not.toBe(0);
    expect(pruneJson.error?.code).toBe("E_BINDING_NOT_FOUND");
  });

  test("installed file dependency exposes executable node_modules/.bin/llmdoc", async () => {
    const packageDir = path.resolve(__dirname, "..");
    const consumerDir = fs.mkdtempSync(path.join(process.cwd(), "llmdoc-consumer-"));
    try {
      const { spawnSync } = await import("node:child_process");
      const packageJsonPath = path.join(consumerDir, "package.json");
      fs.writeFileSync(
        packageJsonPath,
        `${JSON.stringify(
          {
            name: "llmdoc-consumer",
            version: "1.0.0",
            private: true,
            dependencies: { "@tokenroll/llmdoc": `file:${packageDir}` }
          },
          null,
          2
        )}\n`
      );
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
    const rootDir = makeTempDir("llmdoc-misc-version-");
    const version = await runCli(["--version"], rootDir);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).toBe(PACKAGE_VERSION);
  });
});
