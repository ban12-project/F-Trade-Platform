import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { productCatalogImport } from "../lib/db/product-catalog-schema";
import { productMediaAsset } from "../lib/db/product-media-schema";
import * as schema from "../lib/db/schema";
import { decideGuardedVideoReview } from "../lib/video/product-media-guarded-operations";
import { assertVideoWorkingEvidenceRetained } from "../lib/video/retention-access";
import {
  cleanupExpiredVideoObjects,
  purgeVideoRetentionObject,
} from "../lib/video/retention-cleanup";
import { VideoRetentionError, videoRetentionMilliseconds } from "../lib/video/retention-policy";
import { reviewEvidenceSourceProtectedCondition } from "../lib/video/review-evidence-policy";
import {
  listVideoReviewEvidenceCopies,
  registerVideoReviewWorkingEvidence,
  VideoReviewCopyError,
} from "../lib/video/review-evidence-store";
import { assertAndLinkProjectEvidence, listProjectEvidenceOptions } from "../lib/workspace/access";
import { seedVideoReviewFixture } from "../tests/fixtures/video-review";

const connection = process.env.VIDEO_RETENTION_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw new Error("Outbound forbidden in review-copy tests");
};
const db = getDatabase(),
  pool = new Pool({ connectionString: connection });
let cachedSession: {
  user: typeof schema.user.$inferSelect;
  session: typeof schema.session.$inferSelect;
} | null = null;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", { exports: { revalidatePath: () => {}, refresh: () => {} } });
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: async () => cachedSession } } },
});
const { registerVideoReviewWorkingEvidenceAction: action } = await import(
  "../lib/actions/marketing-video"
);
type Fixture = Awaited<ReturnType<typeof seedVideoReviewFixture>>;
const bytes = new Set<string>(),
  deleted: string[] = [];
const store = {
  async delete(path: string) {
    assert(bytes.has(path), "Only known synthetic review bytes");
    bytes.delete(path);
    deleted.push(path);
  },
};
let scenarios = 0;
const old = () => new Date(Date.now() - videoRetentionMilliseconds - 1000);
const identity = (f: Fixture) => ({
  actorId: f.actorId,
  sessionId: f.sessionId,
  projectId: f.projectId,
});
const input = (f: Fixture) => ({
  projectId: f.projectId,
  videoId: f.videoId,
  evidenceRef: f.decisionRef,
  workingCopyOnly: true,
});
async function fixture(decision: "approved" | "rejected" = "rejected") {
  const f = await seedVideoReviewFixture(db);
  const blobKey = `evidence/${f.decisionRef}/synthetic-review.csv`;
  bytes.add(blobKey);
  await db
    .update(schema.evidence)
    .set({ blobKey, sourceLabel: "uploaded:csv" })
    .where(eq(schema.evidence.id, f.decisionRef));
  await decideGuardedVideoReview(
    {
      videoId: f.videoId,
      decision,
      evidenceRef: f.decisionRef,
      notes: "SYNTHETIC review",
    },
    identity(f),
    db,
  );
  await db.insert(schema.productDocumentUploadReceipt).values({
    id: randomUUID(),
    projectId: f.projectId,
    ownerId: f.actorId,
    purpose: "evidence",
    blobPath: blobKey,
    originalFilename: "SYNTHETIC review.csv",
    contentType: "text/csv",
    sizeBytes: 1,
    evidenceId: f.decisionRef,
    expiresAt: new Date(Date.now() + 3600000),
  });
  return f;
}
async function snapshot(f: Fixture) {
  return {
    file: (await db.select().from(schema.evidence).where(eq(schema.evidence.id, f.decisionRef)))[0],
    video: (
      await db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, f.videoId))
    )[0],
    approvals: await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.aggregateId, f.videoId)),
    copies: await db
      .select()
      .from(schema.videoReviewWorkingEvidence)
      .where(eq(schema.videoReviewWorkingEvidence.evidenceId, f.decisionRef)),
    registrations: await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.aggregateId, f.videoId),
          eq(schema.auditEvent.action, "video_review_working_evidence.registered"),
        ),
      ),
  };
}
async function observeWait(pid: number) {
  const deadline = performance.now() + 5000;
  while (true) {
    const { rows } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (rows[0].blocked) return;
    assert(performance.now() < deadline, "Observe actual DB lock wait");
    await delay(10);
  }
}
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  const active = await fixture("approved");
  const before = await snapshot(active);
  assert(
    (await listProjectEvidenceOptions(active.projectId, active.actorId, db)).some(
      (r) => r.id === active.decisionRef,
    ),
  );
  const [candidate] = (
    await listVideoReviewEvidenceCopies([active.videoId], active.actorId, db)
  ).get(active.videoId)!;
  assert(candidate.canRegister && !candidate.registered);
  const registered = await registerVideoReviewWorkingEvidence(input(active), identity(active), db);
  const after = await snapshot(active);
  assert.deepEqual(after.file, before.file);
  assert.deepEqual(after.video, before.video);
  assert.deepEqual(after.approvals, before.approvals);
  assert.equal(after.copies.length, 1);
  assert.equal(after.registrations.length, 1);
  assert.equal(
    registered.expiresAt,
    new Date(
      Math.min(before.file.createdAt.getTime(), before.video.createdAt.getTime()) +
        videoRetentionMilliseconds,
    ).toISOString(),
  );
  await registerVideoReviewWorkingEvidence(input(active), identity(active), db);
  assert.deepEqual(
    await snapshot(active),
    after,
    "Retry does not renew cutoff, declaration or audit",
  );
  assert(
    !(await listProjectEvidenceOptions(active.projectId, active.actorId, db)).some(
      (r) => r.id === active.decisionRef,
    ),
  );
  await assert.rejects(
    assertAndLinkProjectEvidence(active.projectId, [active.decisionRef], active.actorId, db),
    /只能用于所属视频审核/,
  );
  await assertAndLinkProjectEvidence(
    active.projectId,
    [active.decisionRef],
    active.actorId,
    db,
    active.videoId,
  );
  scenarios++;

  for (const change of [
    "owner",
    "banned",
    "role",
    "session",
    "viewer",
    "archived",
    "unowned",
    "other_review",
    "missing_receipt",
    "declaration",
  ] as const) {
    const f = await fixture();
    if (change === "owner")
      await db
        .update(schema.evidence)
        .set({ uploadedById: f.ownerId })
        .where(eq(schema.evidence.id, f.decisionRef));
    if (change === "banned")
      await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
    if (change === "role")
      await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, f.actorId));
    if (change === "session")
      await db
        .update(schema.session)
        .set({ expiresAt: old() })
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
    if (change === "archived")
      await db
        .update(schema.workspaceProject)
        .set({ status: "archived" })
        .where(eq(schema.workspaceProject.id, f.projectId));
    if (change === "unowned")
      await db
        .update(schema.workspaceProjectItem)
        .set({ role: "product_reference", relation: "reference" })
        .where(eq(schema.workspaceProjectItem.id, f.linkId));
    if (change === "other_review")
      await db.insert(schema.approval).values({
        id: randomUUID(),
        aggregateId: active.videoId,
        gate: "gate_01_truth",
        status: "rejected",
        decidedByType: "human",
        decidedById: f.actorId,
        decidedAt: new Date(),
        requestedByType: "human",
        requestedById: f.actorId,
        requestedAt: new Date(),
        evidenceRef: f.decisionRef,
      });
    if (change === "missing_receipt")
      await db
        .delete(schema.productDocumentUploadReceipt)
        .where(eq(schema.productDocumentUploadReceipt.evidenceId, f.decisionRef));
    const prior = await snapshot(f);
    await assert.rejects(
      registerVideoReviewWorkingEvidence(
        { ...input(f), workingCopyOnly: change !== "declaration" },
        identity(f),
        db,
      ),
    );
    assert.deepEqual(await snapshot(f), prior, "Rejected declaration is atomic");
    scenarios++;
  }

  for (const use of [
    "product_payload",
    "video_fact",
    "video_rights",
    "historical_audit",
    "historical_workflow",
    "agent_receipt",
    "source_image",
    "catalog",
    "product_media",
  ] as const) {
    const f = await fixture();
    if (use === "product_payload")
      await db
        .update(schema.aggregateRecord)
        .set({ payload: { synthetic: true, evidence_refs: [f.decisionRef] } })
        .where(eq(schema.aggregateRecord.id, f.productId));
    if (use === "video_fact")
      await db
        .update(schema.aggregateRecord)
        .set({
          payload: {
            ...f.video,
            factualClaims: [
              { field: "product.product_name", value: "SYNTHETIC", evidenceRef: f.decisionRef },
            ],
          },
        })
        .where(eq(schema.aggregateRecord.id, f.videoId));
    if (use === "historical_audit")
      await db.insert(schema.auditEvent).values({
        id: randomUUID(),
        aggregateId: f.productId,
        action: "synthetic.fact_bound",
        actorType: "human",
        actorId: f.actorId,
        subjectType: "product",
        subjectId: f.productId,
        metadata: { evidence_ref: f.decisionRef },
        occurredAt: new Date(),
      });
    if (use === "agent_receipt")
      await db
        .update(schema.productDocumentUploadReceipt)
        .set({ purpose: "agent" })
        .where(eq(schema.productDocumentUploadReceipt.evidenceId, f.decisionRef));
    if (use === "video_rights")
      await db
        .update(schema.aggregateRecord)
        .set({
          payload: {
            ...f.video,
            sourceAssets: [
              { assetRef: f.sourceRef, mediaType: "image", rightsEvidenceRef: f.decisionRef },
            ],
          },
        })
        .where(eq(schema.aggregateRecord.id, f.videoId));
    if (use === "historical_workflow")
      await db.insert(schema.workflowEvent).values({
        id: randomUUID(),
        aggregateId: f.productId,
        fromState: "PRODUCT_DRAFT",
        toState: "PRODUCT_READY",
        actorType: "human",
        actorId: f.actorId,
        evidenceRefs: [f.decisionRef],
        occurredAt: new Date(),
      });
    if (use === "source_image")
      await db.insert(schema.productSourceImage).values({
        id: randomUUID(),
        projectId: f.projectId,
        productId: f.productId,
        evidenceId: f.decisionRef,
      });
    if (use === "catalog") {
      const [receipt] = await db
        .select()
        .from(schema.productDocumentUploadReceipt)
        .where(eq(schema.productDocumentUploadReceipt.evidenceId, f.decisionRef));
      await db.insert(productCatalogImport).values({
        id: randomUUID(),
        projectId: f.projectId,
        actorId: f.actorId,
        receiptId: receipt.id,
        evidenceId: f.decisionRef,
        status: "queued",
      });
    }
    if (use === "product_media")
      await db.insert(productMediaAsset).values({
        id: randomUUID(),
        productId: f.productId,
        evidenceId: f.decisionRef,
        rightsEvidenceRef: f.sourceRef,
        origin: "factory",
        mediaType: "image",
        role: "product_hero",
        contentType: "image/png",
        width: 1,
        height: 1,
        createdBy: f.actorId,
      });
    const [protection] = await db
      .select({ protected: reviewEvidenceSourceProtectedCondition(schema.evidence.id) })
      .from(schema.evidence)
      .where(eq(schema.evidence.id, f.decisionRef));
    assert(protection.protected);
    const prior = await snapshot(f);
    await assert.rejects(
      registerVideoReviewWorkingEvidence(input(f), identity(f), db),
      VideoReviewCopyError,
    );
    assert.deepEqual(await snapshot(f), prior);
    scenarios++;
  }

  // Action rejects spoofed identities/unconfirmed declarations and suppresses private errors.
  const f = await fixture();
  const [auth] = await db
    .select()
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.id, f.sessionId));
  cachedSession = auth;
  const prior = await snapshot(f);
  assert.equal((await action({ ...input(f), actorId: f.actorId })).status, "error");
  assert.equal((await action({ ...input(f), workingCopyOnly: false })).status, "error");
  assert.deepEqual(await snapshot(f), prior);
  cachedSession = null;
  assert.equal((await action(input(f))).status, "error");
  cachedSession = auth;
  assert.equal((await action(input(f))).status, "success");
  scenarios++;

  const privacy = await fixture();
  const [privacyAuth] = await db
    .select()
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.id, privacy.sessionId));
  cachedSession = privacyAuth;
  const privacyBefore = await snapshot(privacy);
  await pool.query(
    "CREATE FUNCTION synthetic_review_copy_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_REVIEW_DETAIL'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER synthetic_review_copy_failure BEFORE INSERT ON video_review_working_evidence FOR EACH ROW EXECUTE FUNCTION synthetic_review_copy_failure()",
  );
  try {
    const failed = await action(input(privacy));
    assert.equal(failed.status, "error");
    assert(!JSON.stringify(failed).includes("SYNTHETIC_PRIVATE_REVIEW_DETAIL"));
    assert.deepEqual(await snapshot(privacy), privacyBefore);
  } finally {
    await pool.query("DROP TRIGGER synthetic_review_copy_failure ON video_review_working_evidence");
    await pool.query("DROP FUNCTION synthetic_review_copy_failure()");
  }
  scenarios++;

  // Absolute parent and file cutoffs deny reads and permit cleanup despite Gate and upload receipt.
  for (const expired of ["parent", "file"] as const) {
    const f = await fixture();
    await registerVideoReviewWorkingEvidence(input(f), identity(f), db);
    if (expired === "parent")
      await db
        .update(schema.aggregateRecord)
        .set({ createdAt: old() })
        .where(eq(schema.aggregateRecord.id, f.videoId));
    else
      await db
        .update(schema.evidence)
        .set({ createdAt: old() })
        .where(eq(schema.evidence.id, f.decisionRef));
    await assert.rejects(
      assertVideoWorkingEvidenceRetained(db, [f.decisionRef]),
      VideoRetentionError,
    );
    await assert.rejects(
      registerVideoReviewWorkingEvidence(input(f), identity(f), db),
      VideoRetentionError,
    );
    const original = (
      await db.select().from(schema.evidence).where(eq(schema.evidence.id, f.sourceRef))
    )[0];
    const file = (await snapshot(f)).file;
    const result = await cleanupExpiredVideoObjects(db, store);
    assert.equal(result.failed, 0);
    const purged = (await snapshot(f)).file;
    assert.equal(purged.blobKey, `retired/${f.decisionRef}`);
    assert.equal(purged.sha256, file.sha256);
    assert.equal(purged.createdAt.getTime(), file.createdAt.getTime());
    assert.deepEqual(
      (await db.select().from(schema.evidence).where(eq(schema.evidence.id, f.sourceRef)))[0],
      original,
    );
    assert.equal((await snapshot(f)).copies.length, 1);
    scenarios++;
  }

  // Authorization can expire while the final audit INSERT waits; no partial association survives.
  const waiting = await fixture(),
    blocker = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() + 1500) })
      .where(eq(schema.session.id, waiting.sessionId));
    const prior = await snapshot(waiting);
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE audit_event IN SHARE MODE");
    const {
      rows: [r],
    } = await blocker.query("SELECT pg_backend_pid() AS pid");
    pending = registerVideoReviewWorkingEvidence(input(waiting), identity(waiting), db);
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await observeWait(r.pid);
    await delay(1600);
    await blocker.query("COMMIT");
    assert((await outcome) instanceof Error);
    assert.deepEqual(await snapshot(waiting), prior);
    scenarios++;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending?.catch(() => {});
  }

  // A stale cleanup job must recheck a factory binding after waiting for evidence locks.
  const race = await fixture();
  await registerVideoReviewWorkingEvidence(input(race), identity(race), db);
  await db
    .update(schema.evidence)
    .set({ createdAt: old() })
    .where(eq(schema.evidence.id, race.decisionRef));
  const raceFile = (await snapshot(race)).file,
    cleanupId = randomUUID();
  await db.insert(schema.videoRetentionCleanup).values({
    id: cleanupId,
    objectKind: "evidence",
    objectRef: race.decisionRef,
    blobPath: raceFile.blobKey,
    policyVersion: "1.1.0",
    originalCreatedAt: raceFile.createdAt,
  });
  const claim = await pool.connect();
  let purge: Promise<unknown> | undefined;
  try {
    await claim.query("BEGIN");
    await claim.query("SELECT id FROM evidence WHERE id=$1 FOR SHARE", [race.decisionRef]);
    const {
      rows: [r],
    } = await claim.query("SELECT pg_backend_pid() AS pid");
    purge = purgeVideoRetentionObject(cleanupId, db, store);
    await observeWait(r.pid);
    await claim.query("UPDATE aggregate_record SET payload=$1::jsonb WHERE id=$2", [
      JSON.stringify({ synthetic: true, evidence_refs: [race.decisionRef] }),
      race.productId,
    ]);
    await claim.query("COMMIT");
    assert.equal(await purge, "protected");
    assert(bytes.has(raceFile.blobKey));
    scenarios++;
  } finally {
    await claim.query("ROLLBACK");
    claim.release();
    await purge?.catch(() => {});
  }
  console.log(
    `PASS ${scenarios} synthetic PostgreSQL review-copy scenarios; only synthetic bytes, no external I/O`,
  );
} finally {
  await pool.end();
  await closeDatabase();
}
