import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { enqueueRun, initialState } from "../lib/browser-fleet/policy";
import { reconcilePublications } from "../lib/browser-fleet/publication";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as s from "../lib/db/schema";
import { requeueUnsentFacebookMediaPublication } from "../lib/social/facebook-media-store";
import { publicationFailureLabel } from "../lib/social/publication-presentation";
import { seedPublicationAccessFixture } from "../tests/fixtures/publication-access";

const connection = process.env.FACEBOOK_PUBLICATION_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/facebook_publication_test"
)
  throw Error("Dedicated synthetic database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw Error("External network forbidden");
};
const db = getDatabase();
try {
  await migrate(db, { migrationsFolder: "drizzle" });
  for (const scenario of [
    "diagnostic",
    "legacy",
    "untrusted",
    "authorized",
    "quarantined",
  ] as const) {
    const f = await seedPublicationAccessFixture(db, "text", true);
    const reservation = (
      await db.execute(sql`SELECT run_id FROM browser_fleet_publication WHERE job_id=${f.jobId}`)
    ).rows[0];
    const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
    const accountId = randomUUID();
    state.accounts.push({
      id: accountId,
      channelRef: f.channelRef,
      accountRef: f.accountRef,
      enabled: true,
      authState: "ready",
      credentialVersion: 1,
      expectedEgressIp: "203.0.113.10",
      loginCiphertext: null,
      proxyCiphertext: null,
      pollSeconds: 0,
      nextPollAt: 0,
      lastCheckedAt: null,
    });
    const run = enqueueRun(
      state,
      {
        id: String(reservation.run_id),
        accountId,
        kind: "publish",
        jobRef: f.jobId,
        requestedBy: f.actorId,
        authSessionId: null,
      },
      Date.now(),
    );
    run.status = scenario === "quarantined" ? "quarantined" : "failed";
    if (scenario !== "legacy")
      run.publicationFailure = {
        stage: "prepare",
        code: scenario === "untrusted" ? "PRIVATE error text" : "facebook_audience_picker_timeout",
      };
    await db
      .update(s.socialBrowserJob)
      .set({ status: "claimed", failureCode: null })
      .where(eq(s.socialBrowserJob.id, f.jobId));
    await db
      .update(s.socialPublication)
      .set({ status: "submitted" })
      .where(eq(s.socialPublication.id, f.publicationId));
    if (scenario !== "authorized")
      await db.execute(
        sql`UPDATE browser_fleet_publication SET authorization_id=NULL, authorized_lease_id=NULL, authorized_until=NULL, receipt=NULL, received_at=NULL WHERE job_id=${f.jobId}`,
      );
    await db.transaction(async (tx) => {
      await reconcilePublications(tx, f.nodeId, state, Date.now());
      await tx.execute(
        sql`UPDATE browser_fleet_node SET document=${JSON.stringify(state)}::jsonb WHERE id=${f.nodeId}`,
      );
    });
    const [job] = await db
      .select()
      .from(s.socialBrowserJob)
      .where(eq(s.socialBrowserJob.id, f.jobId));
    const [publication] = await db
      .select()
      .from(s.socialPublication)
      .where(eq(s.socialPublication.id, f.publicationId));
    const uncertain = ["authorized", "quarantined"].includes(scenario);
    assert.equal(publication.status, uncertain ? "unknown" : "failed");
    assert.equal(
      job.failureCode,
      uncertain
        ? "fleet_publication_result_unknown"
        : scenario === "diagnostic"
          ? "fleet_publication_not_authorized:prepare:facebook_audience_picker_timeout"
          : "fleet_publication_not_authorized",
    );
    if (scenario === "diagnostic")
      assert.match(publicationFailureLabel(job.failureCode) ?? "", /无法识别公开发布选项/);
    if (uncertain)
      await assert.rejects(
        db.transaction((tx) =>
          requeueUnsentFacebookMediaPublication(tx, f.jobId, f.publicationId, f.actorId),
        ),
        /not_proven_unsent/,
      );
    else {
      await db.transaction((tx) =>
        requeueUnsentFacebookMediaPublication(tx, f.jobId, f.publicationId, f.actorId),
      );
      const [retry] = await db
        .select()
        .from(s.socialBrowserJob)
        .where(eq(s.socialBrowserJob.id, f.jobId));
      assert.equal(retry.status, "queued");
    }
    console.log(`${scenario}: diagnosis, reconciliation and unsent retry guard passed`);
  }
} finally {
  await closeDatabase();
}
