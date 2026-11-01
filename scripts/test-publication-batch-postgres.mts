import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { FleetState } from "../lib/browser-fleet/policy";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as s from "../lib/db/schema";
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
const { submitPublicationBatch } = await import("../lib/social/publication-batch-store");
const db = getDatabase();
try {
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
      targets: original.accounts.map(({ channelRef, accountRef }) => ({ channelRef, accountRef })),
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
    // A lost response remains replayable after one account becomes paused.
    await db
      .update(s.socialChannelControl)
      .set({ enabled: false, circuitStatus: "paused", pauseReason: "manual_pause" })
      .where(eq(s.socialChannelControl.accountRef, extra.accountRef));
    assert.deepEqual(await submitPublicationBatch(input, f.identity, db), result[0]);
    assert.equal(await count(), 2);
    console.log(
      `${format}: atomic target validation, state preservation, stale preview, concurrency, replay and refresh passed`,
    );
  }
} finally {
  await closeDatabase();
}
