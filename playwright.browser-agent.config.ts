import { defineConfig } from "@playwright/test";

// Standalone synthetic DOM regressions; no Next server or real accounts.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "browser-publication-executor.spec.ts",
    "facebook-driver.spec.ts",
    "facebook-inbox.spec.ts",
    "facebook-login-executor.spec.ts",
    "facebook-login-fill.spec.ts",
  ],
  outputDir: "test-results/browser-agent-regression",
  timeout: 30_000,
  workers: 2,
  reporter: "list",
  use: { headless: true },
});
