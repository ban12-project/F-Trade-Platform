import { existsSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { Pool } from "pg";

async function preflight() {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Browser acceptance requires Node 24.");
  if (!existsSync(chromium.executablePath()))
    throw new Error("Chromium is missing. Run pnpm exec playwright install chromium.");
  const layer = process.argv[2];
  if (layer !== "ui" && layer !== "database") throw new Error("Choose ui or database acceptance.");
  const database = layer === "database";
  writeFileSync(
    `.tsconfig-playwright-${layer}.json`,
    JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { incremental: false } }),
  );
  if (database) {
    const pool = new Pool({
      connectionString: "postgresql://synthetic:synthetic@127.0.0.1:5432/f_trade_browser_test",
      connectionTimeoutMillis: 3000,
    });
    try {
      await pool.query("SELECT 1");
    } catch {
      throw new Error(
        "Start the dedicated loopback f_trade_browser_test database before acceptance.",
      );
    } finally {
      await pool.end();
    }
  }
}

preflight().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Acceptance preflight failed");
  process.exitCode = 1;
});
