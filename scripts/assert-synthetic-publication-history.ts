import assert from "node:assert/strict";
import { z } from "zod";

// Playwright runs outside the react-server module condition. Keep this read-model
// assertion in a server subprocess without weakening the application's guard.
const address = new URL(process.env.DATABASE_URL ?? "");
if (
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  !["/f_trade_browser_test", "/browser_fleet_test"].includes(address.pathname)
)
  throw new Error("Dedicated loopback synthetic database required");
process.env.DATABASE_TRANSPORT = "postgres";
const projectId = z.uuid().parse(process.argv[2]);
const olderId = z.uuid().parse(process.argv[3]);

async function assertSyntheticHistory() {
  const { closeDatabase, getDatabase } = await import("../lib/db/client");
  const { listProjectPublicationData } = await import("../lib/social/publication-store");
  try {
    const data = await listProjectPublicationData(projectId, getDatabase());
    assert.ok(data.publications.some((item) => item.id === olderId));
    assert.equal(data.candidates.length, 0);
    assert.ok(
      data.publications.every((item) => !("textConfirmation" in item) && !("browserJobId" in item)),
    );
  } finally {
    await closeDatabase();
  }
}
void assertSyntheticHistory();
