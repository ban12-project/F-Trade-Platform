import { z } from "zod";

// This helper runs under --conditions=react-server, outside Playwright's browser-side
// module environment. It must never connect to a saved or production database.
if (
  process.env.DATABASE_URL !==
  "postgresql://synthetic:synthetic@127.0.0.1:5432/f_trade_browser_test"
)
  throw new Error("Dedicated synthetic browser database required");
process.env.DATABASE_TRANSPORT = "postgres";
const jobId = z.uuid().parse(process.argv[2]);
const externalPublicationRef = z
  .string()
  .regex(/^synthetic-post-[0-9a-f-]{36}$/)
  .parse(process.argv[3]);
async function recordSyntheticReceipt() {
  const { closeDatabase, getDatabase } = await import("../lib/db/client");
  const { recordControlledPublicationResult } = await import("../lib/social/publication-store");
  try {
    await recordControlledPublicationResult(
      { jobId, outcome: "published", externalPublicationRef },
      getDatabase(),
    );
  } finally {
    await closeDatabase();
  }
}
void recordSyntheticReceipt();
