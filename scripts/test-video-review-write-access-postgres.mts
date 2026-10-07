import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import {
  authorizeLockedVideoReview,
  VIDEO_REVIEW_ACCESS_MESSAGE,
  VideoReviewAccessError,
} from "../lib/video/review-write-access";
import { seedVideoReviewFixture } from "../tests/fixtures/video-review";

const connection = process.env.VIDEO_REVIEW_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw new Error("Outbound forbidden in synthetic video review tests");
};
const db = getDatabase();
const pool = new Pool({ connectionString: connection });
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
const { reviewMarketingVideoAction } = await import("../lib/actions/marketing-video");
const { decideGuardedVideoReview } = await import("../lib/video/product-media-guarded-operations");
type Fixture = Awaited<ReturnType<typeof seedVideoReviewFixture>>;
const identity = (f: Fixture) => ({
  actorId: f.actorId,
  sessionId: f.sessionId,
  projectId: f.projectId,
});
async function fixture() {
  const f = await seedVideoReviewFixture(db);
  sid = f.sessionId;
  cachedSession = undefined;
  return f;
}
async function snapshot(f: Fixture) {
  const [videos, gates, workflows, audits, links, projects] = await Promise.all([
    db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, f.videoId)),
    db.select().from(schema.approval).where(eq(schema.approval.aggregateId, f.videoId)),
    db.select().from(schema.workflowEvent).where(eq(schema.workflowEvent.aggregateId, f.videoId)),
    db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, f.videoId)),
    db
      .select()
      .from(schema.workspaceProjectEvidence)
      .where(eq(schema.workspaceProjectEvidence.projectId, f.projectId)),
    db
      .select({ updatedAt: schema.workspaceProject.updatedAt })
      .from(schema.workspaceProject)
      .where(eq(schema.workspaceProject.id, f.projectId)),
  ]);
  return { videos, gates, workflows, audits, links, projects };
}
async function blockedBy(pid: number) {
  const {
    rows: [r],
  } = await pool.query<{ blocked: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
    [pid],
  );
  return r.blocked;
}
async function observeWait(pid: number) {
  const deadline = performance.now() + 5_000;
  while (!(await blockedBy(pid))) {
    assert(performance.now() < deadline, "Observe actual PostgreSQL lock wait");
    await delay(10);
  }
}
const run = (f: Fixture, decision: "approved" | "rejected", ref = f.decisionRef) =>
  reviewMarketingVideoAction(f.projectId, f.videoId, decision, ref, "SYNTHETIC reviewer notes");
const changes = [
  "role",
  "revoked",
  "banned",
  "expired",
  "viewer",
  "removed",
  "sales",
  "reference",
] as const;
async function changeAuthorization(f: Fixture, change: (typeof changes)[number]) {
  if (change === "role")
    await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, f.actorId));
  if (change === "revoked")
    await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
  if (change === "banned")
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
  if (change === "expired")
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(schema.session.id, f.sessionId));
  if (change === "viewer")
    await db
      .update(schema.workspaceProjectMember)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceProjectMember.projectId, f.projectId),
          eq(schema.workspaceProjectMember.userId, f.actorId),
        ),
      );
  if (change === "removed")
    await db
      .delete(schema.workspaceProjectMember)
      .where(
        and(
          eq(schema.workspaceProjectMember.projectId, f.projectId),
          eq(schema.workspaceProjectMember.userId, f.actorId),
        ),
      );
  if (change === "sales")
    await db
      .update(schema.workspaceProject)
      .set({ kind: "sales" })
      .where(eq(schema.workspaceProject.id, f.projectId));
  if (change === "reference")
    await db
      .update(schema.workspaceProjectItem)
      .set({ role: "product_reference", relation: "reference" })
      .where(eq(schema.workspaceProjectItem.id, f.linkId));
}
let scenarios = 0;
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  for (const decision of ["approved", "rejected"] as const) {
    for (const sharedEvidence of [false, true]) {
      const f = await fixture();
      if (sharedEvidence) {
        await db
          .update(schema.evidence)
          .set({ uploadedById: f.ownerId })
          .where(eq(schema.evidence.id, f.decisionRef));
        await db.insert(schema.workspaceProjectEvidence).values({
          id: randomUUID(),
          projectId: f.projectId,
          evidenceId: f.decisionRef,
          linkedById: f.ownerId,
        });
      }
      const before = await snapshot(f);
      assert.equal((await run(f, decision)).status, "success");
      const after = await snapshot(f);
      assert.equal(
        after.videos[0].state,
        decision === "approved" ? "VIDEO_APPROVED" : "VIDEO_REVISION_REQUIRED",
      );
      assert.equal(after.videos[0].version, 2);
      assert.equal(after.gates[0].status, decision);
      assert.equal(after.gates[0].decidedById, f.actorId);
      assert.equal(after.gates[0].evidenceRef, f.decisionRef);
      assert.equal(after.gates[0].notes, "SYNTHETIC reviewer notes");
      assert.equal(after.workflows.length, before.workflows.length + 1);
      assert.equal(after.audits.length, before.audits.length + 1);
      assert(after.links.some((link) => link.evidenceId === f.decisionRef));
      const payload = after.videos[0].payload as typeof f.video;
      assert.deepEqual(payload.factualClaims, f.video.factualClaims);
      assert.equal(
        payload.exportArtifact?.status,
        decision === "approved" ? "approved" : "review_required",
      );
      scenarios++;
    }
    for (const change of changes.filter((x) => x !== "sales")) {
      const f = await fixture(),
        blocker = await pool.connect();
      let pending: ReturnType<typeof run> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [f.videoId]);
        const {
          rows: [r],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending = run(f, decision);
        await observeWait(r.pid);
        await changeAuthorization(f, change);
        const before = await snapshot(f);
        await blocker.query("COMMIT");
        assert.equal((await pending).status, "error", `in-flight ${decision}/${change}`);
        assert.deepEqual(await snapshot(f), before);
        scenarios++;
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
      }
    }
    for (const change of changes) {
      const f = await fixture();
      cachedSession = await readSession();
      await changeAuthorization(f, change);
      const before = await snapshot(f);
      assert.equal((await run(f, decision)).status, "error", `stale auth ${decision}/${change}`);
      assert.deepEqual(await snapshot(f), before);
      scenarios++;
    }
    for (const foreign of [false, true]) {
      const f = await fixture();
      if (foreign)
        await db
          .update(schema.evidence)
          .set({ uploadedById: f.ownerId })
          .where(eq(schema.evidence.id, f.decisionRef));
      const before = await snapshot(f);
      const result = await run(
        f,
        decision,
        foreign ? f.decisionRef : `evidence-synthetic-missing-${randomUUID()}`,
      );
      assert.deepEqual(result, { status: "error", message: "部分证据不存在或无权用于当前项目。" });
      assert.deepEqual(await snapshot(f), before);
      scenarios++;
    }
    // Expiration is wall-clock based even while the authorizing rows are reserved.
    for (const resource of [
      "project",
      "video",
      "gate",
      "user",
      "session",
      "member",
      "link",
      "evidence",
      ...(decision === "approved" ? ["product"] : []),
    ]) {
      const f = await fixture(),
        blocker = await pool.connect();
      const expires = new Date(Date.now() + 650);
      await db
        .update(schema.session)
        .set({ expiresAt: expires })
        .where(eq(schema.session.id, f.sessionId));
      cachedSession = await readSession();
      let pending: ReturnType<typeof run> | undefined;
      try {
        const table =
          resource === "project"
            ? "workspace_project"
            : resource === "gate"
              ? "approval"
              : resource === "user"
                ? '"user"'
                : resource === "session"
                  ? "session"
                  : resource === "member"
                    ? "workspace_project_member"
                    : resource === "link"
                      ? "workspace_project_item"
                      : resource === "evidence"
                        ? "evidence"
                        : "aggregate_record";
        const id =
          resource === "project"
            ? f.projectId
            : resource === "gate"
              ? f.approvalId
              : resource === "user"
                ? f.actorId
                : resource === "session"
                  ? f.sessionId
                  : resource === "member"
                    ? undefined
                    : resource === "link"
                      ? f.linkId
                      : resource === "evidence"
                        ? f.decisionRef
                        : resource === "product"
                          ? f.productId
                          : f.videoId;
        await blocker.query("BEGIN");
        if (resource === "member")
          await blocker.query(
            "SELECT id FROM workspace_project_member WHERE project_id=$1 AND user_id=$2 FOR UPDATE",
            [f.projectId, f.actorId],
          );
        else await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
        const {
          rows: [r],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        const before = await snapshot(f);
        pending = run(f, decision);
        await observeWait(r.pid);
        await delay(Math.max(1, expires.getTime() - Date.now() + 30));
        await blocker.query("COMMIT");
        assert.deepEqual(await pending, { status: "error", message: VIDEO_REVIEW_ACCESS_MESSAGE });
        assert.deepEqual(await snapshot(f), before);
        scenarios++;
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
      }
    }
  }
  // The domain API cannot use actor-only, wrong-session or wrong-project identities.
  for (const bad of ["actor only", "wrong session", "wrong project"] as const) {
    const f = await fixture(),
      before = await snapshot(f);
    const input =
      bad === "actor only"
        ? f.actorId
        : { ...identity(f), [bad === "wrong session" ? "sessionId" : "projectId"]: randomUUID() };
    await assert.rejects(
      decideGuardedVideoReview(
        {
          videoId: f.videoId,
          decision: "rejected",
          evidenceRef: f.decisionRef,
          notes: "SYNTHETIC",
        },
        input as never,
      ),
      VideoReviewAccessError,
    );
    assert.deepEqual(await snapshot(f), before);
    scenarios++;
  }
  // Existing truth/publication guards remain mandatory for approval; rejection remains available.
  for (const issue of ["changed product", "missing export", "private media"] as const) {
    const f = await fixture();
    if (issue === "changed product")
      await db
        .update(schema.aggregateRecord)
        .set({
          payload: {
            ...f.product,
            product: { ...f.product.product, product_name: "SYNTHETIC changed fact" },
          },
        })
        .where(eq(schema.aggregateRecord.id, f.productId));
    else
      await db
        .update(schema.aggregateRecord)
        .set({
          payload:
            issue === "missing export"
              ? { ...f.video, exportArtifact: undefined }
              : {
                  ...f.video,
                  sourceAssets: f.video.sourceAssets.map((asset) => ({
                    ...asset,
                    usagePolicy: "private_test_only",
                  })),
                },
        })
        .where(eq(schema.aggregateRecord.id, f.videoId));
    const before = await snapshot(f);
    assert.equal((await run(f, "approved")).status, "error");
    assert.deepEqual(await snapshot(f), before);
    assert.equal((await run(f, "rejected")).status, "success");
    scenarios++;
  }
  // Lock reservations make an authorized decision linearize before concurrent revocation.
  for (const resource of ["user", "session", "member", "link"] as const) {
    const f = await fixture(),
      client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await db.transaction(async (tx) => {
        await authorizeLockedVideoReview(tx, identity(f), f.videoId);
        const [{ pid }] = (await tx.execute<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows;
        const table =
          resource === "user"
            ? '"user"'
            : resource === "session"
              ? "session"
              : resource === "member"
                ? "workspace_project_member"
                : "workspace_project_item";
        const id =
          resource === "user" ? f.actorId : resource === "session" ? f.sessionId : f.linkId;
        pending =
          resource === "user"
            ? client.query('UPDATE "user" SET role=$2 WHERE id=$1', [f.actorId, "user"])
            : resource === "member"
              ? client.query(
                  "DELETE FROM workspace_project_member WHERE project_id=$1 AND user_id=$2",
                  [f.projectId, f.actorId],
                )
              : client.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
        await observeWait(pid);
        assert(await blockedBy(pid));
      });
      await pending;
      scenarios++;
    } finally {
      await pending;
      client.release();
    }
  }
  console.log(
    `PASS ${scenarios} actual-Action video Gate scenarios: current authorization, real lock waits, natural expiry, atomic evidence, truth guards and reserved writes; synthetic only`,
  );
} finally {
  mock.restoreAll();
  await pool.end();
  await closeDatabase();
}
