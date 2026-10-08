import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as s from "../lib/db/schema";
import {
  SOCIAL_HUMAN_ACCESS_MESSAGE,
  type SocialActorIdentity,
  SocialHumanAccessError,
} from "../lib/social/human-write-access";
import { seedInboundRoutingFixture } from "../tests/fixtures/inbound-routing";

const connection = process.env.INBOUND_ROUTING_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw Error("External delivery forbidden in routing tests");
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
      if (cacheFailure) throw Error("SYNTHETIC private refresh failure");
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: async () => current } } },
});
const { routeInboundConversationAction: action } = await import("../lib/actions/closing");
const { routeInboundConversation: domain } = await import("../lib/social/inbound-routing-store");
type Fixture = Awaited<ReturnType<typeof seedInboundRoutingFixture>>;
type Mode = "create" | "link";
async function fixture(role = "user") {
  const f = await seedInboundRoutingFixture(db, role);
  const [user] = await db.select().from(s.user).where(eq(s.user.id, f.actorId));
  const [session] = await db.select().from(s.session).where(eq(s.session.id, f.sessionId));
  current = { user, session };
  return f;
}
function input(f: Fixture, mode: Mode) {
  return {
    conversationId: f.conversationId,
    mode,
    ...(mode === "link" && { projectId: f.projectId }),
  };
}
function run(f: Fixture, mode: Mode) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(input(f, mode))) fd.set(key, value);
  return action({ status: "idle", message: "" }, fd);
}
async function snapshot(f: Fixture) {
  const r = await db.execute(sql`SELECT
    (SELECT count(*)::int FROM workspace_project WHERE created_by_id=${f.actorId}) AS projects,
    (SELECT count(*)::int FROM workspace_project_member WHERE user_id=${f.actorId}) AS members,
    (SELECT count(*)::int FROM aggregate_record WHERE type='lead' AND created_by_id=${f.actorId}) AS leads,
    (SELECT count(*)::int FROM workspace_project_item i JOIN workspace_project p ON p.id=i.project_id WHERE p.created_by_id=${f.actorId}) AS items,
    (SELECT count(*)::int FROM audit_event WHERE actor_id=${f.actorId}) AS audits,
    (SELECT lead_id FROM social_conversation WHERE id=${f.conversationId}) AS lead_id`);
  return r.rows[0];
}
async function observeWait(pid: number) {
  const deadline = performance.now() + 5000;
  for (;;) {
    const {
      rows: [{ blocked }],
    } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (blocked) return;
    assert(performance.now() < deadline, "Actual PostgreSQL wait required");
    await delay(10);
  }
}
function assertCommitted(
  before: Awaited<ReturnType<typeof snapshot>>,
  after: typeof before,
  mode: Mode,
) {
  assert.equal(after.projects, Number(before.projects) + (mode === "create" ? 1 : 0));
  assert.equal(after.members, Number(before.members) + (mode === "create" ? 1 : 0));
  assert.equal(after.leads, Number(before.leads) + 1);
  assert.equal(after.items, Number(before.items) + 1);
  assert.equal(after.audits, Number(before.audits) + (mode === "create" ? 2 : 1));
  assert(after.lead_id);
}
let count = 0;
try {
  await migrate(db, { migrationsFolder: "drizzle" });
  for (const mode of ["create", "link"] as const) {
    for (const role of ["admin", "user"]) {
      const f = await fixture(role),
        before = await snapshot(f);
      const result = await run(f, mode);
      assert.equal(result.status, "success");
      assert.deepEqual(Object.keys(result).sort(), ["id", "message", "projectId", "status"]);
      assertCommitted(before, await snapshot(f), mode);
      assert.equal((await snapshot(f)).lead_id, result.id);
      if (mode === "link") assert.equal(result.projectId, f.projectId);
      count++;
    }
    for (const change of [
      "revoked",
      "banned",
      "denied-role",
      "wrong-session",
      "expired",
      "natural-expiry",
    ] as const) {
      const f = await fixture(),
        held = await pool.connect();
      await held.query("BEGIN");
      const {
        rows: [{ pid }],
      } = await held.query("SELECT pg_backend_pid() AS pid");
      await held.query("SELECT id FROM social_conversation WHERE id=$1 FOR UPDATE", [
        f.conversationId,
      ]);
      try {
        const pending = run(f, mode);
        await observeWait(pid);
        if (change === "revoked") await db.delete(s.session).where(eq(s.session.id, f.sessionId));
        if (change === "banned")
          await db.update(s.user).set({ banned: true }).where(eq(s.user.id, f.actorId));
        if (change === "denied-role")
          await db.update(s.user).set({ role: "synthetic-denied" }).where(eq(s.user.id, f.actorId));
        if (change === "wrong-session") {
          const other = await seedInboundRoutingFixture(db);
          await db
            .update(s.session)
            .set({ userId: other.actorId })
            .where(eq(s.session.id, f.sessionId));
        }
        if (change === "expired" || change === "natural-expiry") {
          const expiresAt = new Date(Date.now() + (change === "expired" ? -1 : 80));
          await db.update(s.session).set({ expiresAt }).where(eq(s.session.id, f.sessionId));
          if (change === "natural-expiry") await delay(100);
        }
        const before = await snapshot(f);
        await held.query("COMMIT");
        const response = await pending;
        assert.equal(response.status, "error");
        assert.equal(response.message, SOCIAL_HUMAN_ACCESS_MESSAGE);
        assert.deepEqual(await snapshot(f), before);
        count++;
      } finally {
        await held.query("ROLLBACK");
        held.release();
      }
    }
    // All project/lead/relationship/pointer writes before the final audit must roll back.
    {
      const f = await fixture(),
        trigger = `synthetic_routing_${randomUUID().replaceAll("-", "")}`,
        key = Date.now();
      await db.execute(
        sql.raw(
          `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='${f.actorId}' AND NEW.action='social_inbound.routed' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}();`,
        ),
      );
      const held = await pool.connect();
      await held.query("BEGIN");
      const {
        rows: [{ pid }],
      } = await held.query("SELECT pg_backend_pid() AS pid");
      await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
      try {
        const expiresAt = new Date(Date.now() + 900);
        await db.update(s.session).set({ expiresAt }).where(eq(s.session.id, f.sessionId));
        const before = await snapshot(f),
          pending = run(f, mode);
        await observeWait(pid);
        await delay(Math.max(0, expiresAt.getTime() - Date.now() + 10));
        await held.query("COMMIT");
        assert.equal((await pending).status, "error");
        assert.deepEqual(await snapshot(f), before);
        count++;
      } finally {
        await held.query("ROLLBACK");
        held.release();
        await db.execute(
          sql.raw(`DROP TRIGGER ${trigger} ON audit_event; DROP FUNCTION ${trigger}();`),
        );
      }
    }
    const f = await fixture(),
      before = await snapshot(f);
    const responses = await Promise.all(Array.from({ length: 8 }, () => run(f, mode)));
    assert.equal(responses.filter((r) => r.status === "success").length, 1);
    assert.equal(responses.filter((r) => r.status === "error").length, 7);
    assertCommitted(before, await snapshot(f), mode);
    count++;
    const refreshed = await fixture(),
      prior = await snapshot(refreshed);
    cacheFailure = true;
    try {
      assert.equal((await run(refreshed, mode)).status, "success");
      assertCommitted(prior, await snapshot(refreshed), mode);
      count++;
    } finally {
      cacheFailure = false;
    }
    const legacy = await fixture(),
      original = await snapshot(legacy);
    await assert.rejects(
      () => domain(input(legacy, mode), legacy.actorId as unknown as SocialActorIdentity, db),
      SocialHumanAccessError,
    );
    assert.deepEqual(await snapshot(legacy), original);
    count++;
  }
  for (const change of [
    "viewer",
    "removed",
    "archived",
    "kind",
    "revoked",
    "banned",
    "natural-expiry",
  ] as const) {
    const f = await fixture(),
      held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM workspace_project WHERE id=$1 FOR UPDATE", [f.projectId]);
    try {
      const pending = run(f, "link");
      await observeWait(pid);
      if (change === "viewer")
        await db
          .update(s.workspaceProjectMember)
          .set({ role: "viewer" })
          .where(
            and(
              eq(s.workspaceProjectMember.userId, f.actorId),
              eq(s.workspaceProjectMember.projectId, f.projectId),
            ),
          );
      if (change === "removed")
        await db
          .delete(s.workspaceProjectMember)
          .where(
            and(
              eq(s.workspaceProjectMember.userId, f.actorId),
              eq(s.workspaceProjectMember.projectId, f.projectId),
            ),
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
      if (change === "banned")
        await db.update(s.user).set({ banned: true }).where(eq(s.user.id, f.actorId));
      if (change === "natural-expiry") {
        await db
          .update(s.session)
          .set({ expiresAt: new Date(Date.now() + 80) })
          .where(eq(s.session.id, f.sessionId));
        await delay(100);
      }
      const before = await snapshot(f);
      await held.query("COMMIT");
      assert.equal((await pending).status, "error");
      assert.deepEqual(await snapshot(f), before);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  // Reserve actor/session and editable membership until the actual route commits.
  for (const [mode, kind] of [
    ["create", "session"],
    ["link", "session"],
    ["link", "member"],
  ] as const) {
    const f = await fixture(),
      trigger = `synthetic_routing_reserve_${randomUUID().replaceAll("-", "")}`,
      key = Date.now();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='${f.actorId}' AND NEW.action='social_inbound.routed' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}();`,
      ),
    );
    const held = await pool.connect(),
      revoker = await pool.connect();
    await held.query("BEGIN");
    await revoker.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    const {
      rows: [{ revokerPid }],
    } = await revoker.query('SELECT pg_backend_pid() AS "revokerPid"');
    await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
    let pendingRevocation: ReturnType<typeof revoker.query> | undefined;
    try {
      const before = await snapshot(f),
        pending = run(f, mode);
      await observeWait(pid);
      pendingRevocation =
        kind === "session"
          ? revoker.query("DELETE FROM session WHERE id=$1", [f.sessionId])
          : revoker.query(
              "UPDATE workspace_project_member SET role='viewer' WHERE project_id=$1 AND user_id=$2",
              [f.projectId, f.actorId],
            );
      const deadline = performance.now() + 5000;
      for (;;) {
        const {
          rows: [{ blocked }],
        } = await pool.query("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked", [revokerPid]);
        if (blocked) break;
        assert(performance.now() < deadline, "Authorization must remain reserved");
        await delay(10);
      }
      await held.query("COMMIT");
      assert.equal((await pending).status, "success");
      await pendingRevocation;
      await revoker.query("ROLLBACK");
      assertCommitted(before, await snapshot(f), mode);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
      await pendingRevocation;
      await revoker.query("ROLLBACK");
      revoker.release();
      await db.execute(
        sql.raw(`DROP TRIGGER ${trigger} ON audit_event; DROP FUNCTION ${trigger}();`),
      );
    }
  }
  const editor = await fixture();
  await db
    .update(s.workspaceProjectMember)
    .set({ role: "editor" })
    .where(eq(s.workspaceProjectMember.userId, editor.actorId));
  assert.equal((await run(editor, "link")).status, "success");
  count++;
  console.log(
    `PASS ${count} actual inbound routing authorization cases; observed waits, atomic expiry rollback, one lead under concurrency and committed refresh recovery; synthetic only, no outbound`,
  );
} finally {
  await pool.end();
  await closeDatabase();
}
