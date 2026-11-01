import assert from "node:assert/strict";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
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
  throw Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
process.env.BROWSER_SANDBOX_ENABLED = "1";
process.env.FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID = "synthetic";
process.env.FACEBOOK_CREDENTIAL_KEYS_JSON = JSON.stringify({
  synthetic: Buffer.alloc(32, 3).toString("base64"),
});
globalThis.fetch = async () => {
  throw Error("External I/O forbidden in publication submission tests");
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
const { ownerBrowserCommand } = await import("../lib/browser-fleet/store");
const { schedulePublications } = await import("../lib/browser-fleet/publication");
const { submitControlledPublication, listProjectPublicationData } = await import(
  "../lib/social/publication-store"
);
const { submitFacebookMediaPublication } = await import("../lib/social/facebook-media-store");
const db = getDatabase();
const pool = new Pool({ connectionString: connection });
let count = 0;
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  for (const scenario of [
    "text",
    "image",
    "video",
    "text-busy",
    "image-busy",
    "video-busy",
  ] as const) {
    const format = scenario.split("-")[0] as "text" | "image" | "video";
    const f = await seedPublicationAccessFixture(db, format);
    process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = f.actorId;
    const actor = { id: f.actorId, sessionId: f.sessionId };
    const { nodeId } = await ownerBrowserCommand(
      {
        operation: "create",
        value: {
          name: "SYNTHETIC VPS publication submission",
          gatewayOrigin: "https://synthetic-node.example.invalid",
          maxBrowsers: 1,
          memoryBudgetMb: 2048,
          browserMemoryMb: 2048,
        },
      },
      actor,
    );
    assert(nodeId);
    // Literal proxy IPs persist without a deployment network allowlist.
    await ownerBrowserCommand(
      {
        operation: "grant",
        value: {
          nodeId,
          channelRef: f.channelRef,
          accountRef: f.accountRef,
          expectedEgressIp: "203.0.113.10",
          pollSeconds: 0,
          credentials: {
            loginUsername: "",
            loginPassword: "",
            proxyHost: "192.0.2.42",
            proxyPort: "3128",
            proxyUsername: "",
            proxyPassword: "",
            clearLogin: false,
            clearProxy: false,
          },
        },
      },
      actor,
    );
    const nodes = await db.execute(
      sql`SELECT document FROM browser_fleet_node WHERE id = ${nodeId}`,
    );
    const state = nodes.rows[0].document as FleetState;
    assert.equal(state.accounts.length, 1);
    assert.ok(state.accounts[0].proxyCiphertext);
    assert.equal(
      (await db.execute(sql`SELECT id FROM browser_fleet_binding WHERE node_id = ${nodeId}`)).rows
        .length,
      1,
    );
    state.capabilities = ["publish"];
    state.accounts[0].authState = "ready";
    state.publicationScopes = [
      { channelRef: f.channelRef, accountRef: f.accountRef, expiresAt: Date.now() + 3600000 },
    ];
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(state)}::jsonb WHERE id = ${nodeId}`,
    );
    const submit = () =>
      format === "text"
        ? submitControlledPublication(f.submission, f.identity, db)
        : submitFacebookMediaPublication(f.mediaSubmission, f.identity, db);
    const snapshot = async () => ({
      node: (await db.execute(sql`SELECT document FROM browser_fleet_node WHERE id = ${nodeId}`))
        .rows,
      sandbox: (await db.execute(sql`SELECT * FROM browser_sandbox WHERE node_id = ${nodeId}`))
        .rows,
      outbox: (
        await db.execute(sql`SELECT * FROM browser_sandbox_outbox WHERE node_id = ${nodeId}`)
      ).rows,
      reservations: (
        await db.execute(sql`SELECT * FROM browser_fleet_publication WHERE node_id = ${nodeId}`)
      ).rows,
      publications: await db
        .select()
        .from(s.socialPublication)
        .where(eq(s.socialPublication.projectId, f.projectId)),
      jobs: await db
        .select()
        .from(s.socialBrowserJob)
        .where(eq(s.socialBrowserJob.accountRef, f.accountRef)),
      audits: (
        await db.execute(
          sql`SELECT * FROM audit_event WHERE action IN ('social_publication.submitted', 'facebook_media.confirmed') AND (aggregate_id = ${f.contentId} OR subject_id IN (SELECT id FROM social_publication WHERE project_id = ${f.projectId}))`,
        )
      ).rows,
    });
    // The supported VPS agent reserves durable demand on its next claim, under
    // the node lock. Submission must not start a retired managed Sandbox.
    const reserve = () =>
      db.transaction(async (tx) => {
        const rows = await tx.execute(sql`SELECT document FROM browser_fleet_node
        WHERE id = ${nodeId} FOR UPDATE`);
        const current = rows.rows[0].document as FleetState;
        await schedulePublications(tx, nodeId, current, Date.now());
        await tx.execute(sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(current)}::jsonb
        WHERE id = ${nodeId}`);
      });
    await assert.rejects(
      ownerBrowserCommand({ operation: "create-sandbox", value: { name: "Retired" } }, actor),
      /vercel_sandbox_retired_use_vps/,
    );
    const before = await snapshot();
    if (scenario.endsWith("-busy")) {
      const blocker = await pool.connect();
      let pending: ReturnType<typeof submit> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM browser_fleet_node WHERE id = $1 FOR UPDATE", [nodeId]);
        pending = submit();
        await Promise.race([
          pending,
          delay(5000).then(() => {
            throw Error("Submission must not wait for the node lock while holding business rows");
          }),
        ]);
        const deferred = await snapshot();
        assert.equal(deferred.publications.length, 1);
        assert.equal(deferred.outbox.length, 0);
        assert.equal(deferred.reservations.length, 0);
        assert.equal(deferred.sandbox.length, 0);
        assert.equal(deferred.jobs.length, 1);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending?.catch(() => {});
      }
      await reserve();
      const recovered = await snapshot();
      assert.equal(recovered.publications.length, 1);
      assert.equal(recovered.outbox.length, 0);
      assert.equal(recovered.reservations.length, 1);
      assert.equal(recovered.sandbox.length, 0);
      await reserve();
      assert.deepEqual(await snapshot(), recovered);
      count++;
      continue;
    }
    await db.execute(
      sql`CREATE FUNCTION synthetic_reject_publication_start() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('social_publication.submitted', 'facebook_media.confirmed') THEN RAISE EXCEPTION 'SYNTHETIC publication audit rejected'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER synthetic_reject_publication_start AFTER INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_reject_publication_start()`,
    );
    try {
      // Audit failure after business insertion rolls back the job and publication together.
      await assert.rejects(submit, (error: unknown) => {
        assert(
          String((error as { cause?: unknown }).cause ?? error).includes(
            "SYNTHETIC publication audit rejected",
          ),
          String((error as { cause?: unknown }).cause ?? error),
        );
        return true;
      });
      assert.deepEqual(await snapshot(), before);
      count++;
    } finally {
      await db.execute(sql`DROP TRIGGER synthetic_reject_publication_start ON audit_event`);
      await db.execute(sql`DROP FUNCTION synthetic_reject_publication_start()`);
    }
    const replies = await Promise.all([submit(), submit(), submit()]);
    assert.deepEqual(replies[0], replies[1]);
    assert.deepEqual(replies[1], replies[2]);
    const submitted = await snapshot();
    assert.equal(submitted.publications.length, 1);
    assert.equal(submitted.jobs.length, 1);
    assert.equal(submitted.reservations.length, 0);
    assert.equal(submitted.outbox.length, 0);
    assert.equal(submitted.sandbox.length, 0);
    await reserve();
    const saved = await snapshot();
    assert.equal(saved.publications.length, 1);
    assert.equal(saved.jobs.length, 1);
    assert.equal(saved.reservations.length, 1);
    assert.equal(saved.outbox.length, 0, "VPS publication never starts retired Sandbox compute");
    assert.equal(saved.sandbox.length, 0);
    await reserve();
    assert.deepEqual(await snapshot(), saved, "recovery does not duplicate the committed intent");
    count++;
    for (const code of [
      "publication_publish_unknown",
      "SYNTHETIC private legacy error",
      "toString",
      "__proto__",
      null,
    ]) {
      await db
        .update(s.socialBrowserJob)
        .set({ failureCode: code })
        .where(eq(s.socialBrowserJob.id, saved.jobs[0].id));
      const data = await listProjectPublicationData(f.projectId, db);
      const entry = data.publications.find((item) => item.id === saved.publications[0].id);
      assert(entry);
      assert(!Object.hasOwn(entry, "failureCode"), "raw diagnostic never reaches client props");
      assert.equal(
        entry.failureLabel,
        code === "publication_publish_unknown" ? "发布步骤未取得可验证回执" : null,
      );
      assert(!JSON.stringify(data).includes("SYNTHETIC private legacy error"));
    }
    count++;
  }
  console.log(
    `PASS ${count} PostgreSQL VPS text/image/video submission, rollback, idempotency and diagnostic privacy scenarios; no external I/O`,
  );
} finally {
  await closeDatabase();
  await pool.end();
}
