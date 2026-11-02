import { spawnSync } from "node:child_process";
import { Pool } from "pg";

// Never inherit a business database URL for acceptance.
const connection = "postgresql://synthetic:synthetic@127.0.0.1:5432/f_trade_stream_test";
const pool = new Pool({ connectionString: connection, connectionTimeoutMillis: 3000 });
try {
  await pool.query("SELECT 1");
} catch {
  throw new Error("Start the dedicated loopback f_trade_stream_test database before acceptance.");
} finally {
  await pool.end();
}
for (const script of [
  "test-publication-submission-wakeup-postgres.mts",
  "test-publication-batch-postgres.mts",
]) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--conditions=react-server",
      "--import",
      "tsx",
      `scripts/${script}`,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, SOCIAL_HUMAN_WRITE_TEST_DATABASE_URL: connection },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
