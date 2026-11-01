import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { FleetState, Run } from "../lib/browser-fleet/policy";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as s from "../lib/db/schema";
import { digestSocialWorkerPayload } from "../lib/social/worker-protocol";
import {
  seedPublicationAccessFixture,
  syntheticPublicationBytes,
} from "../tests/fixtures/publication-access";

const connection = process.env.SOCIAL_HUMAN_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
process.env.BROWSER_SANDBOX_ENABLED = "0";
globalThis.fetch = async () => {
  throw Error("External network forbidden");
};
mock.module("@vercel/blob", {
  exports: {
    get: async () => ({
      statusCode: 200,
      stream: new ReadableStream({
        start(c) {
          c.enqueue(syntheticPublicationBytes);
          c.close();
        },
      }),
    }),
  },
});
const { recordPublicationReceipt } = await import("../lib/browser-fleet/publication");
const { submitPublicationBatch } = await import("../lib/social/publication-batch-store");
const { recordControlledPublicationResult } = await import("../lib/social/publication-store");
const { buildFacebookMediaPayload, buildFacebookPublicationPayload } = await import(
  "../lib/social/facebook-media-store"
);
const db = getDatabase();
try {
  for (const outcome of ["published", "failed", "unknown"] as const)
    for (const format of ["text", "image", "video"] as const) {
      const f = await seedPublicationAccessFixture(db, format);
      process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = f.actorId;
      const original = (
        await db.execute(sql`SELECT document FROM browser_fleet_node WHERE id = ${f.nodeId}`)
      ).rows[0].document as FleetState;
      const extra = {
        ...original.accounts[0],
        id: randomUUID(),
        accountRef: randomUUID(),
        displayName: "SYNTHETIC second account",
      };
      original.accounts.push(extra);
      original.publicationScopes = original.accounts.map((a) => ({
        channelRef: a.channelRef,
        accountRef: a.accountRef,
        expiresAt: Date.now() + 3600000,
        textOnly: false,
      }));
      await db.execute(
        sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(original)}::jsonb WHERE id = ${f.nodeId}`,
      );
      await db.execute(
        sql`INSERT INTO browser_fleet_binding(id,node_id,channel_ref,account_ref) VALUES(${extra.id},${f.nodeId},${extra.channelRef},${extra.accountRef})`,
      );
      await db.insert(s.socialChannelControl).values({
        id: randomUUID(),
        channelRef: extra.channelRef,
        accountRef: extra.accountRef,
        enabled: true,
        circuitStatus: "active",
        changedBy: f.actorId,
        changedAt: new Date(),
      });
      const { channelRef: _c, accountRef: _a, confirmationRef: _r, ...text } = f.submission;
      const { channelRef: _mc, accountRef: _ma, confirm: _confirm, ...media } = f.mediaSubmission;
      const input = {
        batchId: randomUUID(),
        audience: "Public",
        targets: original.accounts.map(({ channelRef, accountRef }) => ({
          channelRef,
          accountRef,
        })),
        content: format === "text" ? text : media,
      };
      const count = async () =>
        (
          await db
            .select()
            .from(s.socialPublication)
            .where(eq(s.socialPublication.projectId, f.projectId))
        ).length;
      // Any invalid target rejects the complete batch and preserves every control.
      for (const state of ["needs_login", "disabled", "manual_pause", "exception_pause"] as const) {
        const changed = structuredClone(original);
        if (state === "needs_login") changed.accounts[1].authState = "needs_login";
        if (state === "disabled") changed.accounts[1].enabled = false;
        await db.execute(
          sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(changed)}::jsonb WHERE id = ${f.nodeId}`,
        );
        if (state.includes("pause"))
          await db
            .update(s.socialChannelControl)
            .set({ enabled: false, circuitStatus: "paused", pauseReason: state })
            .where(eq(s.socialChannelControl.accountRef, extra.accountRef));
        await assert.rejects(submitPublicationBatch(input, f.identity, db));
        assert.equal(await count(), 0);
        const after = (
          await db.execute(sql`SELECT document FROM browser_fleet_node WHERE id = ${f.nodeId}`)
        ).rows[0].document;
        assert.deepEqual(after, changed);
        await db
          .update(s.socialChannelControl)
          .set({ enabled: true, circuitStatus: "active", pauseReason: null })
          .where(eq(s.socialChannelControl.accountRef, extra.accountRef));
      }
      await db.execute(
        sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(original)}::jsonb WHERE id = ${f.nodeId}`,
      );
      await assert.rejects(
        submitPublicationBatch(
          { ...input, content: { ...input.content, previewDigest: "0".repeat(64) } },
          f.identity,
          db,
        ),
      );
      assert.equal(await count(), 0);
      const result = await Promise.all(
        Array.from({ length: 3 }, () => submitPublicationBatch(input, f.identity, db)),
      );
      assert.deepEqual(result[0], result[1]);
      assert.deepEqual(result[1], result[2]);
      assert.equal(await count(), 2);
      // Refresh/new token cannot duplicate the same content/version/attachment per account.
      const refreshed = await submitPublicationBatch(
        { ...input, batchId: randomUUID() },
        f.identity,
        db,
      );
      assert.deepEqual(refreshed, result[0]);
      assert.equal(await count(), 2);
      await assert.rejects(
        submitPublicationBatch({ ...input, targets: input.targets.slice(0, 1) }, f.identity, db),
      );
      // First successful receipt must not invalidate the second target's approved
      // source/version. Real result logic; only its external receipt is synthetic.
      const sourceBefore = await db
        .select()
        .from(s.aggregateRecord)
        .where(eq(s.aggregateRecord.id, f.contentId));
      for (const [index, target] of result[0].entries()) {
        const [publication] = await db
          .select()
          .from(s.socialPublication)
          .where(eq(s.socialPublication.id, target.publicationId));
        await db.transaction(async (tx) => {
          if (format === "text") await buildFacebookPublicationPayload(tx, publication, new Date());
          else await buildFacebookMediaPayload(tx, publication, new Date());
        });
        await db
          .update(s.socialBrowserJob)
          .set({ status: "claimed" })
          .where(eq(s.socialBrowserJob.id, publication.browserJobId!));
        if (index === 0) {
          const account = original.accounts.find((a) => a.accountRef === target.accountRef)!;
          const run = {
            id: randomUUID(),
            kind: "publish",
            jobRef: publication.browserJobId,
            accountId: account.id,
            status: "running",
            stopRequested: false,
            leaseId: randomUUID(),
            leaseUntil: Date.now() + 60000,
            deadline: Date.now() + 60000,
            credentialVersion: account.credentialVersion,
          } as Run;
          const authorizationId = randomUUID();
          await db.transaction(async (tx) => {
            const payload = await buildFacebookPublicationPayload(tx, publication, new Date());
            await tx.execute(sql`INSERT INTO browser_fleet_publication(job_id,node_id,run_id,payload,authorization_id,authorized_lease_id,authorized_until)
            VALUES(${publication.browserJobId},${f.nodeId},${run.id},${JSON.stringify(payload)}::jsonb,${authorizationId},${run.leaseId},${Date.now() + 30000})`);
            await recordPublicationReceipt(
              tx,
              f.nodeId,
              original,
              run,
              {
                authorizationId,
                payloadDigest: digestSocialWorkerPayload(payload),
                outcome: "published",
                externalPublicationRef: "https://www.facebook.com/synthetic/posts/1",
              },
              Date.now(),
            );
          });
        } else
          await recordControlledPublicationResult(
            {
              jobId: publication.browserJobId,
              outcome,
              ...(outcome === "published"
                ? { externalPublicationRef: "https://www.facebook.com/synthetic/posts/2" }
                : { failureCode: "synthetic_observation_failure" }),
            },
            db,
          );
        const saved = await db
          .select()
          .from(s.socialPublication)
          .where(eq(s.socialPublication.id, target.publicationId));
        assert.equal(saved[0].status, index === 0 ? "published" : outcome);
        assert.deepEqual(
          await db.select().from(s.aggregateRecord).where(eq(s.aggregateRecord.id, f.contentId)),
          sourceBefore,
        );
      }
      // A lost response remains replayable after one account becomes paused.
      await db
        .update(s.socialChannelControl)
        .set({ enabled: false, circuitStatus: "paused", pauseReason: "manual_pause" })
        .where(eq(s.socialChannelControl.accountRef, extra.accountRef));
      assert.deepEqual(await submitPublicationBatch(input, f.identity, db), result[0]);
      assert.equal(await count(), 2);
      console.log(
        `${format}/${outcome}: receipt isolation, source version preservation, atomic target validation, state preservation, stale preview, concurrency, replay and refresh passed`,
      );
    }
  const image = await seedPublicationAccessFixture(db, "image", true);
  process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = image.actorId;
  const { reconcileUnknownTextPublication } = await import(
    "../lib/social/publication-reconciliation"
  );
  await db.insert(s.auditEvent).values({
    id: randomUUID(),
    actorType: "human",
    actorId: image.actorId,
    action: "social_publication.batch_submitted",
    subjectType: "publication_batch",
    subjectId: randomUUID(),
    metadata: { results: [{ publicationId: image.publicationId }] },
    occurredAt: new Date(),
  });
  const originalImage = await db
    .select()
    .from(s.aggregateRecord)
    .where(eq(s.aggregateRecord.id, image.contentId));
  await assert.rejects(
    reconcileUnknownTextPublication(
      { ...image.reconciliation, externalPublicationRef: "https://example.invalid/post" },
      image.identity,
      db,
    ),
  );
  const resolved = await reconcileUnknownTextPublication(image.reconciliation, image.identity, db);
  assert.equal(resolved.id, image.publicationId);
  assert.deepEqual(
    await db.select().from(s.aggregateRecord).where(eq(s.aggregateRecord.id, image.contentId)),
    originalImage,
  );
  const control = await db
    .select()
    .from(s.socialChannelControl)
    .where(eq(s.socialChannelControl.accountRef, image.accountRef));
  assert.equal(control[0].circuitStatus, "paused");
  assert.equal(
    (await reconcileUnknownTextPublication(image.reconciliation, image.identity, db)).replayed,
    true,
  );
  console.log(
    "image unknown reconciliation verifies original media, preserves batch source and pause, and replays safely",
  );
} finally {
  await closeDatabase();
}
