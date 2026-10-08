import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { z } from "zod";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as s from "../lib/db/schema";
import type { followUpFormSchema } from "../lib/form-schemas";
import {
  SocialHumanAccessError,
  type SocialProjectIdentity,
} from "../lib/social/human-write-access";
import { decryptSocialMessageBody } from "../lib/social/message-crypto";
import { seedFollowUpFixture } from "../tests/fixtures/follow-up-access";

const connection = process.env.FOLLOW_UP_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
globalThis.fetch = async () => {
  throw Error("External delivery forbidden");
};
const db = getDatabase(),
  pool = new Pool({ connectionString: connection });
let current:
    | { user: typeof s.user.$inferSelect; session: typeof s.session.$inferSelect }
    | undefined,
  cacheFailure = false;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", {
  exports: {
    revalidatePath: () => {
      if (cacheFailure) throw Error("PRIVATE refresh detail");
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: async () => current } } },
});
const { recordFollowUpAction: action } = await import("../lib/actions/closing");
const { recordFollowUp: domain } = await import("../lib/sales/closing-store");
type Fixture = Awaited<ReturnType<typeof seedFollowUpFixture>>;
type Context = z.infer<typeof followUpFormSchema>["context"];
async function fixture(role = "user") {
  const f = await seedFollowUpFixture(db, role);
  const [user] = await db.select().from(s.user).where(eq(s.user.id, f.actorId));
  const [session] = await db.select().from(s.session).where(eq(s.session.id, f.sessionId));
  current = { user, session };
  return f;
}
function input(f: Fixture, context: Context = "quote_sent_unread") {
  return {
    projectId: f.projectId,
    leadId: f.leadId,
    context,
    triggeredRules: ["active_inquiry" as const],
    draft: "SYNTHETIC reply only",
    confirmationRef: f.confirmationRef,
  };
}
function run(f: Fixture, context: Context = "quote_sent_unread") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(input(f, context))) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, v);
  }
  return action({ status: "idle", message: "" }, fd);
}
async function snapshot(f: Fixture) {
  const r = await db.execute(sql`SELECT
    (SELECT count(*)::int FROM social_browser_job WHERE channel_ref=${f.channelRef}) AS jobs,
    (SELECT count(*)::int FROM social_message WHERE conversation_id=${f.conversationId} AND direction='outbound') AS outbound,
    (SELECT count(*)::int FROM audit_event WHERE actor_id=${f.actorId} AND action='lead.follow_up_submitted') AS audits,
    (SELECT version FROM aggregate_record WHERE id=${f.leadId}) AS version,
    (SELECT payload FROM aggregate_record WHERE id=${f.leadId}) AS payload`);
  return r.rows[0];
}
async function observeWait(pid: number) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const {
      rows: [{ blocked }],
    } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (blocked) return;
    assert(Date.now() < deadline, "Actual PostgreSQL wait required");
    await delay(10);
  }
}
async function committed(f: Fixture, jobs = 1) {
  const a = await snapshot(f);
  assert.equal(a.jobs, jobs);
  assert.equal(a.outbound, jobs);
  assert.equal(a.audits, jobs);
  assert.equal(a.version, jobs + 1);
  const [message] = await db
    .select()
    .from(s.socialMessage)
    .where(
      and(
        eq(s.socialMessage.conversationId, f.conversationId),
        eq(s.socialMessage.direction, "outbound"),
      ),
    );
  assert(!message.bodyCiphertext.includes("SYNTHETIC reply"));
  assert(decryptSocialMessageBody(message.bodyCiphertext).includes("SYNTHETIC reply only"));
}
async function deliveryExpiry(f: Fixture, expiresAt: Date) {
  await db.execute(
    sql`UPDATE aggregate_record SET payload=jsonb_set(payload,'{result,valid_until}',to_jsonb(${expiresAt.toISOString()}::text)) WHERE id=${f.deliveryId}`,
  );
}
let count = 0;
try {
  await migrate(db, { migrationsFolder: "drizzle" });
  for (const role of ["user", "admin"])
    for (const context of ["quote_sent_unread", "asks_lead_time"] as const) {
      const f = await fixture(role);
      const result = await run(f, context);
      assert.equal(result.status, "success");
      assert.deepEqual(Object.keys(result).sort(), ["id", "message", "status"]);
      await committed(f);
      count++;
    }
  for (const context of [
    "quote_sent_read_no_reply",
    "price_high",
    "purchase_later",
    "asks_sample",
  ] as const) {
    const f = await fixture();
    assert.equal((await run(f, context)).status, "success");
    await committed(f);
    count++;
  }
  for (const change of [
    "revoked",
    "banned",
    "role",
    "wrong-session",
    "expired",
    "natural-expiry",
    "viewer",
    "removed",
    "unlinked",
  ] as const) {
    const f = await fixture(),
      held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [f.leadId]);
    try {
      const before = await snapshot(f),
        pending = run(f);
      await observeWait(pid);
      if (change === "revoked") await db.delete(s.session).where(eq(s.session.id, f.sessionId));
      if (change === "banned")
        await db.update(s.user).set({ banned: true }).where(eq(s.user.id, f.actorId));
      if (change === "role")
        await db.update(s.user).set({ role: "synthetic-denied" }).where(eq(s.user.id, f.actorId));
      if (change === "wrong-session") {
        const other = await seedFollowUpFixture(db);
        await db
          .update(s.session)
          .set({ userId: other.actorId })
          .where(eq(s.session.id, f.sessionId));
      }
      if (change === "expired" || change === "natural-expiry") {
        await db
          .update(s.session)
          .set({ expiresAt: new Date(Date.now() + (change === "expired" ? -1 : 80)) })
          .where(eq(s.session.id, f.sessionId));
        if (change === "natural-expiry") await delay(100);
      }
      const member = and(
        eq(s.workspaceProjectMember.projectId, f.projectId),
        eq(s.workspaceProjectMember.userId, f.actorId),
      );
      if (change === "viewer")
        await db.update(s.workspaceProjectMember).set({ role: "viewer" }).where(member);
      if (change === "removed") await db.delete(s.workspaceProjectMember).where(member);
      // The lead join reserves its link before it waits: change it from the lock holder.
      if (change === "unlinked")
        await held.query("DELETE FROM workspace_project_item WHERE id=$1", [f.ownedId]);
      await held.query("COMMIT");
      assert.equal((await pending).status, "error");
      assert.deepEqual(await snapshot(f), before);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  for (const change of ["viewer", "removed", "archived", "kind", "revoked"] as const) {
    const f = await fixture(),
      held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM workspace_project WHERE id=$1 FOR UPDATE", [f.projectId]);
    try {
      const before = await snapshot(f),
        pending = run(f);
      await observeWait(pid);
      if (change === "viewer" || change === "removed")
        await held.query(
          change === "viewer"
            ? "UPDATE workspace_project_member SET role='viewer' WHERE project_id=$1 AND user_id=$2"
            : "DELETE FROM workspace_project_member WHERE project_id=$1 AND user_id=$2",
          [f.projectId, f.actorId],
        );
      if (change === "archived")
        await held.query("UPDATE workspace_project SET status='archived' WHERE id=$1", [
          f.projectId,
        ]);
      if (change === "kind")
        await held.query("UPDATE workspace_project SET kind='marketing' WHERE id=$1", [
          f.projectId,
        ]);
      if (change === "revoked") await db.delete(s.session).where(eq(s.session.id, f.sessionId));
      await held.query("COMMIT");
      assert.equal((await pending).status, "error");
      assert.deepEqual(await snapshot(f), before);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  for (const change of ["paused", "disabled"] as const) {
    const f = await fixture(),
      held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM social_channel_control WHERE id=$1 FOR UPDATE", [f.controlId]);
    try {
      const before = await snapshot(f),
        pending = run(f);
      await observeWait(pid);
      await held.query(
        change === "paused"
          ? "UPDATE social_channel_control SET circuit_status='paused',pause_reason='synthetic' WHERE id=$1"
          : "UPDATE social_channel_control SET enabled=false WHERE id=$1",
        [f.controlId],
      );
      await held.query("COMMIT");
      assert.equal((await pending).status, "error");
      assert.deepEqual(await snapshot(f), before);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  for (const change of ["window", "retention", "deleted", "delivery"] as const) {
    const f = await fixture(),
      held = await pool.connect();
    await held.query("BEGIN");
    const expiry = new Date(Date.now() + 1200);
    if (change === "window")
      await db
        .update(s.socialMessage)
        .set({ receivedAt: new Date(expiry.getTime() - 3_600_000) })
        .where(eq(s.socialMessage.id, f.inboundId));
    if (change === "retention")
      await db
        .update(s.socialMessage)
        .set({ expiresAt: expiry })
        .where(eq(s.socialMessage.id, f.inboundId));
    if (change === "delivery") await deliveryExpiry(f, expiry);
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
      change === "delivery" ? f.deliveryId : f.leadId,
    ]);
    try {
      const before = await snapshot(f),
        pending = run(f, change === "delivery" ? "asks_sample" : "quote_sent_unread");
      await observeWait(pid);
      if (change === "deleted")
        await db
          .update(s.socialMessage)
          .set({ deletedAt: new Date() })
          .where(eq(s.socialMessage.id, f.inboundId));
      else await delay(Math.max(0, expiry.getTime() - Date.now() + 20));
      await held.query("COMMIT");
      assert.equal((await pending).status, "error");
      assert.deepEqual(await snapshot(f), before);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  // Hold the final audit after job/message/lead writes; expiry must roll everything back.
  for (const change of [
    "session",
    "window",
    "retention",
    "delivery",
    "reserved-session",
    "reserved-role",
    "reserved-member",
  ] as const) {
    const f = await fixture(),
      trigger = `synthetic_reply_${randomUUID().replaceAll("-", "")}`,
      key = Date.now();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='${f.actorId}' AND NEW.action='lead.follow_up_submitted' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}();`,
      ),
    );
    const held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
    let reservation: Promise<unknown> | undefined;
    try {
      const expiry = new Date(Date.now() + 1500),
        reserved = change.startsWith("reserved-");
      if (change === "session")
        await db.update(s.session).set({ expiresAt: expiry }).where(eq(s.session.id, f.sessionId));
      if (change === "window")
        await db
          .update(s.socialMessage)
          .set({ receivedAt: new Date(expiry.getTime() - 3_600_000) })
          .where(eq(s.socialMessage.id, f.inboundId));
      if (change === "retention")
        await db
          .update(s.socialMessage)
          .set({ expiresAt: expiry })
          .where(eq(s.socialMessage.id, f.inboundId));
      if (change === "delivery") await deliveryExpiry(f, expiry);
      const before = await snapshot(f),
        pending = run(f, change === "delivery" ? "asks_lead_time" : "quote_sent_unread");
      await observeWait(pid);
      if (reserved) {
        const other = await pool.connect();
        const {
          rows: [{ pid: otherPid }],
        } = await other.query("SELECT pg_backend_pid() AS pid");
        const query =
          change === "reserved-session"
            ? ["DELETE FROM session WHERE id=$1", [f.sessionId]]
            : change === "reserved-role"
              ? ["UPDATE \"user\" SET role='synthetic-denied' WHERE id=$1", [f.actorId]]
              : [
                  "UPDATE workspace_project_member SET role='viewer' WHERE project_id=$1 AND user_id=$2",
                  [f.projectId, f.actorId],
                ];
        reservation = other
          .query(query[0] as string, query[1] as string[])
          .finally(() => other.release());
        const deadline = Date.now() + 5000;
        for (;;) {
          const {
            rows: [{ waiting }],
          } = await pool.query("SELECT cardinality(pg_blocking_pids($1))>0 AS waiting", [otherPid]);
          if (waiting) break;
          assert(Date.now() < deadline);
          await delay(10);
        }
      } else await delay(Math.max(0, expiry.getTime() - Date.now() + 20));
      await held.query("COMMIT");
      const result = await pending;
      if (reserved) {
        assert.equal(result.status, "success");
        await reservation;
        await committed(f);
      } else {
        assert.equal(result.status, "error");
        assert.deepEqual(await snapshot(f), before);
      }
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
      await reservation;
      await db.execute(
        sql.raw(`DROP TRIGGER ${trigger} ON audit_event; DROP FUNCTION ${trigger}();`),
      );
    }
  }
  {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => run(f)));
    assert(results.every((r) => r.status === "success"));
    await committed(f);
    count++;
    await db.delete(s.session).where(eq(s.session.id, f.sessionId));
    const before = await snapshot(f);
    assert.equal((await run(f)).status, "error");
    assert.deepEqual(await snapshot(f), before);
    count++;
  }
  {
    const f = await fixture();
    cacheFailure = true;
    try {
      assert.equal((await run(f)).status, "success");
      await committed(f);
      count++;
    } finally {
      cacheFailure = false;
    }
  }
  {
    const f = await fixture(),
      before = await snapshot(f);
    for (const identity of [
      f.actorId,
      { actorId: f.actorId, sessionId: f.sessionId, projectId: randomUUID() },
      { actorId: f.actorId, sessionId: randomUUID(), projectId: f.projectId },
    ]) {
      await assert.rejects(
        () => domain(input(f), identity as SocialProjectIdentity, db),
        SocialHumanAccessError,
      );
      assert.deepEqual(await snapshot(f), before);
      count++;
    }
    await db
      .update(s.workspaceProjectMember)
      .set({ role: "editor" })
      .where(
        and(
          eq(s.workspaceProjectMember.projectId, f.projectId),
          eq(s.workspaceProjectMember.userId, f.actorId),
        ),
      );
    assert.equal((await run(f)).status, "success");
    await committed(f);
    count++;
  }
  console.log(
    `PASS ${count} actual follow-up Action/PostgreSQL authorization, expiry, reservation, rollback and idempotency cases`,
  );
} finally {
  await closeDatabase();
  await pool.end();
}
