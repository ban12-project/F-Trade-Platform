import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  outputDir: "test-results/ui",
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "blob" : "html",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec tsx scripts/playwright-preflight.ts ui && pnpm build:test && pnpm start",
    env: {
      PLAYWRIGHT_LAYER: "ui",
      PORT: String(port),
      NEXT_ENABLE_TESTING_API: "1",
      BETTER_AUTH_SECRET: "synthetic-playwright-secret-1234567890",
      BETTER_AUTH_URL: baseURL,
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:9/f_trade",
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
