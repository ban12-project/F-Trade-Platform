import { sql } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { evidenceUploadIntent } from "../lib/db/schema";
import { reconcileEvidenceUploads } from "../lib/evidence/upload-reconciliation";

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !["--apply", "--dry-run"].includes(args[0])))
    throw new Error("Use --dry-run (default) or --apply");
  const database = getDatabase();
  try {
    if (args[0] === "--apply")
      console.log(JSON.stringify(await reconcileEvidenceUploads(database)));
    else {
      const counts = await database
        .select({ status: evidenceUploadIntent.status, count: sql<number>`count(*)::int` })
        .from(evidenceUploadIntent)
        .groupBy(evidenceUploadIntent.status);
      console.log(JSON.stringify({ mode: "dry-run", counts }));
    }
  } finally {
    await closeDatabase();
  }
}
main().catch(() => {
  console.error("Evidence reconciliation failed; no private error details are printed.");
  process.exitCode = 1;
});
