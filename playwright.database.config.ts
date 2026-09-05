import { defineConfig, devices } from "@playwright/test";

// Deliberately independent of DATABASE_URL and the developer's saved credentials.
export const databaseURL = "postgresql://synthetic:synthetic@127.0.0.1:5432/f_trade_browser_test";
export const authSecret = "synthetic-browser-database-secret-1234567890";
export const socialMessageKey = Buffer.alloc(32, 7).toString("base64");
export const modelConfigKey = Buffer.alloc(32, 8).toString("base64");
const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/database-browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["blob", { outputDir: "blob-report-database" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium-database", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next build && pnpm start",
    env: {
      PORT: String(port),
      NEXT_ENABLE_TESTING_API: "1",
      BETTER_AUTH_SECRET: authSecret,
      BETTER_AUTH_URL: baseURL,
      DATABASE_URL: databaseURL,
      DATABASE_TRANSPORT: "postgres",
      SOCIAL_MESSAGE_ENCRYPTION_KEY: socialMessageKey,
      MODEL_CONFIG_ENCRYPTION_KEY: modelConfigKey,
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
