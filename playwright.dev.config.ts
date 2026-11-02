import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Start NEXT_ENABLE_TESTING_API=1 pnpm dev separately before running this config.
export default defineConfig({
  ...config,
  webServer: undefined,
  workers: 2,
  timeout: 60_000,
  reporter: "list",
});
