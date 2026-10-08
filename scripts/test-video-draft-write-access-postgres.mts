import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import {
  authorizeLockedVideoDraft,
  authorizeOwnedVideoDraft,
  authorizeReadableVideoDraftSource,
  VIDEO_DRAFT_ACCESS_MESSAGE,
  VideoDraftAccessError,
} from "../lib/video/draft-write-access";
import { seedVideoDraftFixture } from "../tests/fixtures/video-draft";

const connection = process.env.VIDEO_DRAFT_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw new Error("Outbound forbidden in synthetic video draft tests");
};
const db = getDatabase(),
  pool = new Pool({ connectionString: connection });
let sid = "";
async function readSession() {
  const [r] = await db
    .select()
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.id, sid));
  return r && !r.user.banned && r.session.expiresAt > new Date() ? r : null;
}
let cachedSession: Awaited<ReturnType<typeof readSession>>;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", { exports: { revalidatePath: () => {}, refresh: () => {} } });
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: async () => cachedSession ?? readSession() } } },
});
const {
  saveMarketingVideoDraftAction,
  copyMarketingVideoDraftAction,
  renderMarketingVideoDraftAction,
} = await import("../lib/actions/marketing-video");
const { updateMarketingVideoEditDraft, copyMarketingVideoDraftToProject } = await import(
  "../lib/video/store"
);
type Fixture = Awaited<ReturnType<typeof seedVideoDraftFixture>>;
type Operation = "save" | "copy";
const identity = (f: Fixture, op: Operation) => ({
  actorId: f.actorId,
  sessionId: f.sessionId,
  projectId: op === "copy" ? f.targetProjectId : f.projectId,
});
async function fixture(role: "admin" | "user" = "user") {
  const f = await seedVideoDraftFixture(db, role);
  sid = f.sessionId;
  cachedSession = undefined;
  return f;
}
const edited = (f: Fixture) => ({
  ...f.draft,
  ctaText: "SYNTHETIC changed CTA",
  clips: f.draft.clips.map((clip) => ({ ...clip, durationMs: 4000 })),
});
const run = (f: Fixture, op: Operation) =>
  op === "save"
    ? saveMarketingVideoDraftAction(f.projectId, f.videoId, edited(f))
    : copyMarketingVideoDraftAction(f.targetProjectId, f.videoId);
async function snapshot(f: Fixture) {
  const [records, audits, links, projects, evidenceLinks] = await Promise.all([
    db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.createdById, f.actorId)),
    db.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorId, f.actorId)),
    db
      .select()
      .from(schema.workspaceProjectItem)
      .where(inArray(schema.workspaceProjectItem.projectId, [f.projectId, f.targetProjectId])),
    db
      .select({ id: schema.workspaceProject.id, updatedAt: schema.workspaceProject.updatedAt })
      .from(schema.workspaceProject)
      .where(inArray(schema.workspaceProject.id, [f.projectId, f.targetProjectId])),
    db
      .select()
      .from(schema.workspaceProjectEvidence)
      .where(inArray(schema.workspaceProjectEvidence.projectId, [f.projectId, f.targetProjectId])),
  ]);
  const ids = records.map((r) => r.id);
  const [gates, workflows, jobs] = await Promise.all([
    db.select().from(schema.approval).where(inArray(schema.approval.aggregateId, ids)),
    db.select().from(schema.workflowEvent).where(inArray(schema.workflowEvent.aggregateId, ids)),
    db
      .select()
      .from(schema.videoProcessingJob)
      .where(inArray(schema.videoProcessingJob.videoProjectId, ids)),
  ]);
  return { records, audits, links, projects, evidenceLinks, gates, workflows, jobs };
}
async function observeWait(pid: number) {
  const deadline = performance.now() + 5000;
  while (true) {
    const {
      rows: [r],
    } = await pool.query<{ blocked: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (r.blocked) return;
    assert(performance.now() < deadline, "Observe actual PostgreSQL lock wait");
    await delay(10);
  }
}
async function assertSuccess(f: Fixture, op: Operation, result: Awaited<ReturnType<typeof run>>) {
  assert.equal(result.status, "success");
  const after = await snapshot(f),
    source = after.records.find((r) => r.id === f.videoId),
    product = after.records.find((r) => r.id === f.productId);
  assert(source && product);
  assert.deepEqual(product.payload, f.product);
  assert.equal(after.audits.length, 1);
  assert.equal(after.gates.length, 0);
  assert.equal(after.workflows.length, 0);
  assert.equal(after.jobs.length, 0);
  if (op === "save") {
    assert.equal(source.version, 2);
    assert.equal(source.state, "VIDEO_DRAFT");
    assert.equal(after.records.length, 2);
    const p = source.payload as typeof f.video;
    assert.deepEqual(p.editDraft, JSON.parse(JSON.stringify(edited(f))));
    assert.deepEqual(p.factualClaims, f.video.factualClaims);
    assert.deepEqual(p.sourceAssets, f.video.sourceAssets);
  } else {
    assert.deepEqual(source.payload, JSON.parse(JSON.stringify(f.video)));
    assert.equal(source.version, 1);
    const copy = after.records.find((r) => r.id === result.videoId);
    assert(copy);
    assert.equal(copy.version, 1);
    assert.equal(copy.state, "VIDEO_DRAFT");
    const p = copy.payload as typeof f.video;
    assert.deepEqual(p.editDraft, JSON.parse(JSON.stringify(f.draft)));
    assert.deepEqual(p.factualClaims, f.video.factualClaims);
    assert.deepEqual(p.sourceAssets, f.video.sourceAssets);
    assert.deepEqual(p.approvalRefs, []);
    assert.equal(p.renderedAssetRef, undefined);
    assert.equal(p.exportArtifact, undefined);
    assert(
      after.links.some(
        (l) =>
          l.projectId === f.targetProjectId &&
          l.aggregateId === copy.id &&
          l.role === "marketing_video" &&
          l.relation === "owned",
      ),
    );
  }
}
const changes = [
  "revoked",
  "banned",
  "expired",
  "role invalid",
  "viewer",
  "removed",
  "source removed",
  "source viewer",
] as const;
async function mutate(f: Fixture, op: Operation, change: (typeof changes)[number]) {
  if (change === "revoked")
    await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
  if (change === "banned")
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
  if (change === "expired")
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(schema.session.id, f.sessionId));
  if (change === "role invalid")
    await db.update(schema.user).set({ role: "untrusted" }).where(eq(schema.user.id, f.actorId));
  const projectId = change.startsWith("source") ? f.projectId : identity(f, op).projectId;
  const member = and(
    eq(schema.workspaceProjectMember.projectId, projectId),
    eq(schema.workspaceProjectMember.userId, f.actorId),
  );
  if (change === "viewer" || change === "source viewer")
    await db.update(schema.workspaceProjectMember).set({ role: "viewer" }).where(member);
  if (change === "removed" || change === "source removed")
    await db.delete(schema.workspaceProjectMember).where(member);
}
let scenarios = 0;
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  for (const op of ["save", "copy"] as const)
    for (const role of ["admin", "user"] as const) {
      {
        const f = await fixture(role);
        await assertSuccess(f, op, await run(f, op));
        scenarios++;
      }
      const mutations = changes.filter((change) => op === "copy" || !change.startsWith("source"));
      for (const change of mutations) {
        const f = await fixture(role),
          blocker = await pool.connect();
        let pending: ReturnType<typeof run> | undefined;
        try {
          await blocker.query("BEGIN");
          await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
            op === "copy" ? f.productId : f.videoId,
          ]);
          const {
            rows: [backend],
          } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          pending = run(f, op);
          await observeWait(backend.pid);
          await mutate(f, op, change);
          const before = await snapshot(f);
          await blocker.query("COMMIT");
          if (change === "source viewer") await assertSuccess(f, op, await pending);
          else {
            assert.equal((await pending).status, "error", `${role}/${op}/${change}`);
            assert.deepEqual(await snapshot(f), before);
          }
          scenarios++;
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await pending;
        }
      }
      for (const change of ["revoked", "banned", "expired", "role invalid"] as const) {
        const f = await fixture(role);
        cachedSession = await readSession();
        await mutate(f, op, change);
        const before = await snapshot(f);
        assert.deepEqual(await run(f, op), {
          status: "error",
          message: VIDEO_DRAFT_ACCESS_MESSAGE,
        });
        assert.deepEqual(await snapshot(f), before);
        scenarios++;
      }
      // Actual waits, not timer-only simulations; near-expiry auth is cached for entry.
      for (const resource of [
        "project",
        "video",
        "user",
        "session",
        "member",
        "link",
        ...(op === "copy" ? ["product", "source member"] : []),
      ]) {
        const f = await fixture(role),
          blocker = await pool.connect();
        const expires = new Date(Date.now() + 650);
        await db
          .update(schema.session)
          .set({ expiresAt: expires })
          .where(eq(schema.session.id, f.sessionId));
        cachedSession = await readSession();
        let pending: ReturnType<typeof run> | undefined;
        try {
          await blocker.query("BEGIN");
          if (resource === "member" || resource === "source member")
            await blocker.query(
              "SELECT id FROM workspace_project_member WHERE project_id=$1 AND user_id=$2 FOR UPDATE",
              [resource === "source member" ? f.projectId : identity(f, op).projectId, f.actorId],
            );
          else {
            const table =
              resource === "project"
                ? "workspace_project"
                : resource === "user"
                  ? '"user"'
                  : resource === "session"
                    ? "session"
                    : resource === "link"
                      ? "workspace_project_item"
                      : "aggregate_record";
            const id =
              resource === "project"
                ? identity(f, op).projectId
                : resource === "user"
                  ? f.actorId
                  : resource === "session"
                    ? f.sessionId
                    : resource === "link"
                      ? f.linkId
                      : resource === "product"
                        ? f.productId
                        : f.videoId;
            await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
          }
          const {
            rows: [backend],
          } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          const before = await snapshot(f);
          pending = run(f, op);
          await observeWait(backend.pid);
          await delay(Math.max(1, expires.getTime() - Date.now() + 30));
          await blocker.query("COMMIT");
          assert.deepEqual(await pending, { status: "error", message: VIDEO_DRAFT_ACCESS_MESSAGE });
          assert.deepEqual(await snapshot(f), before);
          scenarios++;
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await pending;
        }
      }
    }
  for (const op of ["save", "copy"] as const)
    for (const bad of [
      "actor only",
      "wrong session",
      "wrong project",
      "sales",
      "archived",
    ] as const) {
      const f = await fixture();
      let id: unknown = identity(f, op);
      if (bad === "actor only") id = f.actorId;
      if (bad === "wrong session") id = { ...identity(f, op), sessionId: randomUUID() };
      if (bad === "wrong project") id = { ...identity(f, op), projectId: randomUUID() };
      if (bad === "sales" || bad === "archived")
        await db
          .update(schema.workspaceProject)
          .set(bad === "sales" ? { kind: "sales" } : { status: "archived" })
          .where(eq(schema.workspaceProject.id, identity(f, op).projectId));
      const before = await snapshot(f);
      const pending =
        op === "save"
          ? updateMarketingVideoEditDraft(f.videoId, edited(f), id as never)
          : copyMarketingVideoDraftToProject(f.videoId, id as never);
      await assert.rejects(pending);
      assert.deepEqual(await snapshot(f), before);
      scenarios++;
    }
  // A denied manual save inside render cannot queue Workflow or partially save.
  for (const change of ["revoked", "banned", "expired"] as const) {
    const f = await fixture(),
      blocker = await pool.connect();
    let pending: ReturnType<typeof renderMarketingVideoDraftAction> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [f.videoId]);
      const {
        rows: [backend],
      } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      pending = renderMarketingVideoDraftAction(f.projectId, f.videoId, edited(f));
      await observeWait(backend.pid);
      await mutate(f, "save", change);
      const before = await snapshot(f);
      await blocker.query("COMMIT");
      assert.deepEqual(await pending, { status: "error", message: VIDEO_DRAFT_ACCESS_MESSAGE });
      assert.deepEqual(await snapshot(f), before);
      scenarios++;
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  }
  // Rows are reserved until commit, including source viewer membership.
  for (const resource of ["user", "session", "member", "link", "source member"] as const) {
    const f = await fixture(),
      client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await db.transaction(async (tx) => {
        if (resource === "source member") {
          await authorizeReadableVideoDraftSource(tx, identity(f, "copy"), f.projectId);
          await authorizeLockedVideoDraft(tx, identity(f, "copy"));
        } else await authorizeOwnedVideoDraft(tx, identity(f, "save"), f.videoId);
        const [{ pid }] = (await tx.execute<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows;
        if (resource === "user")
          pending = client.query('UPDATE "user" SET banned=true WHERE id=$1', [f.actorId]);
        else if (resource === "session")
          pending = client.query("DELETE FROM session WHERE id=$1", [f.sessionId]);
        else if (resource === "link")
          pending = client.query("DELETE FROM workspace_project_item WHERE id=$1", [f.linkId]);
        else
          pending = client.query(
            "DELETE FROM workspace_project_member WHERE project_id=$1 AND user_id=$2",
            [f.projectId, f.actorId],
          );
        await observeWait(pid);
      });
      await pending;
      scenarios++;
    } finally {
      await pending;
      client.release();
    }
  }
  console.log(
    `PASS ${scenarios} actual-Action video draft cases: writer/source authorization, true lock waits, expiry, complete rollback, source-viewer copies, render-save denial and authorization reservation; synthetic only`,
  );
} finally {
  mock.restoreAll();
  await pool.end();
  await closeDatabase();
}
