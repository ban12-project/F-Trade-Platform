import { defineConfig, devices } from "@playwright/test";
import config from "./playwright.config";

// Optional cross-engine acceptance; Chromium remains the full CI suite.
export default defineConfig({
  ...config,
  // Keep short-lived streaming/focus acceptance observations isolated on local WebKit.
  fullyParallel: false,
  testMatch: "workspace-modern-ux.spec.ts",
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
});
