import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { assertPublicationEligible } from "../lib/social/publication-store";
import { queueVideoProcessingJob } from "../lib/video/processing-jobs";
import {
  beginGuardedMarketingVideoRender,
  decideGuardedVideoReview,
} from "../lib/video/product-media-guarded-operations";
import { assertVideoRetentionForId } from "../lib/video/retention-access";
import {
  cleanupExpiredVideoObjects,
  purgeVideoRetentionObject,
} from "../lib/video/retention-cleanup";
import {
  isVideoObjectRetained,
  VideoRetentionError,
  videoRetentionMilliseconds,
  videoRetentionPolicyVersion,
} from "../lib/video/retention-policy";
import {
  applyMarketingVideoAiDraft,
  copyMarketingVideoDraftToProject,
  getMarketingVideoEditProject,
  listProjectMarketingVideoEntries,
  updateMarketingVideoEditDraft,
} from "../lib/video/store";
import { loadWorkspaceVideoForActor } from "../lib/video/workspace-access";
import { assertAndLinkProjectEvidence } from "../lib/workspace/access";
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
  throw new Error("Outbound forbidden in synthetic retention tests");
};
const db = getDatabase();
const pool = new Pool({ connectionString: connection });
const old = () => new Date(Date.now() - videoRetentionMilliseconds - 10_000);
let scenarios = 0;
const bytes = new Set<string>();
const deleted: string[] = [];
let loseAcknowledgement = "";
const store = {
  async delete(path: string) {
    assert(bytes.has(path) || deleted.includes(path), "Delete only synthetic known bytes");
    bytes.delete(path);
    deleted.push(path);
    if (loseAcknowledgement === path) {
      loseAcknowledgement = "";
      throw new Error("SYNTHETIC lost delete acknowledgement");
    }
  },
};
async function evidence(label = "marketing-upload:image", createdAt = old()) {
  const id = `evidence-synthetic-retention-${randomUUID()}`,
    blobKey = `evidence/${id}/synthetic.png`;
  bytes.add(blobKey);
  await db.insert(schema.evidence).values({
    id,
    blobKey,
    sourceLabel: label,
    createdAt,
    contentType: "image/png",
    sizeBytes: 3,
    sha256: "a".repeat(64),
    classification: "internal",
    uploadedByType: "human",
    uploadedById: "synthetic-retention",
  });
  return { id, blobKey };
}
async function readEvidence(id: string) {
  return (await db.select().from(schema.evidence).where(eq(schema.evidence.id, id)))[0];
}
async function videoSnapshot(id: string) {
  return {
    video: (
      await db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, id))
    )[0],
    gates: await db.select().from(schema.approval).where(eq(schema.approval.aggregateId, id)),
    audits: await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, id)),
    events: await db
      .select()
      .from(schema.workflowEvent)
      .where(eq(schema.workflowEvent.aggregateId, id)),
  };
}
const review = (
  f: Awaited<ReturnType<typeof seedVideoReviewFixture>>,
  decision: "approved" | "rejected" = "approved",
) =>
  decideGuardedVideoReview(
    { videoId: f.videoId, decision, evidenceRef: f.decisionRef, notes: "SYNTHETIC private note" },
    { actorId: f.actorId, projectId: f.projectId, sessionId: f.sessionId },
    db,
  );
async function observeWait(pid: number) {
  const deadline = performance.now() + 5000;
  while (true) {
    const { rows } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (rows[0].blocked) return;
    assert(performance.now() < deadline, "Observe actual PostgreSQL lock wait");
    await delay(10);
  }
}
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  const anchor = new Date("2026-01-01T00:00:00Z"),
    cutoff = new Date(anchor.getTime() + videoRetentionMilliseconds);
  assert(isVideoObjectRetained(anchor, new Date(cutoff.getTime() - 1)));
  assert(!isVideoObjectRetained(anchor, cutoff));
  assert(!isVideoObjectRetained(anchor, new Date(cutoff.getTime() + 1)));
  scenarios++;

  const active = await seedVideoReviewFixture(db);
  assert(await getMarketingVideoEditProject(active.videoId, db));
  const expired = await seedVideoReviewFixture(db);
  await db
    .update(schema.aggregateRecord)
    .set({ createdAt: old() })
    .where(eq(schema.aggregateRecord.id, expired.videoId));
  const before = await videoSnapshot(expired.videoId);
  await assert.rejects(getMarketingVideoEditProject(expired.videoId, db), VideoRetentionError);
  for (const decision of ["approved", "rejected"] as const)
    await assert.rejects(review(expired, decision), VideoRetentionError);
  assert.deepEqual(await videoSnapshot(expired.videoId), before);
  scenarios++;

  const publish = await seedVideoReviewFixture(db);
  await review(publish);
  const channelRef = `synthetic-retention-channel-${randomUUID()}`,
    accountRef = `synthetic-retention-account-${randomUUID()}`;
  await db.insert(schema.socialChannelControl).values({
    id: randomUUID(),
    channelRef,
    accountRef,
    enabled: true,
    circuitStatus: "active",
    changedBy: publish.actorId,
    changedAt: new Date(),
  });
  await db
    .update(schema.aggregateRecord)
    .set({ createdAt: old() })
    .where(eq(schema.aggregateRecord.id, publish.videoId));
  await assert.rejects(
    db.transaction((tx) =>
      assertPublicationEligible(
        {
          projectId: publish.projectId,
          contentRef: publish.videoId,
          format: "video",
          channelRef,
          accountRef,
        },
        tx,
        () => new Date(),
      ),
    ),
    VideoRetentionError,
  );
  scenarios++;

  const draft = await seedVideoReviewFixture(db);
  await db
    .update(schema.aggregateRecord)
    .set({
      state: "VIDEO_DRAFT",
      createdAt: old(),
      payload: {
        ...draft.video,
        status: "draft",
        renderedAssetRef: undefined,
        exportArtifact: undefined,
        approvalRefs: [],
      },
    })
    .where(eq(schema.aggregateRecord.id, draft.videoId));
  const draftBefore = await videoSnapshot(draft.videoId);
  const identity = {
    actorId: draft.actorId,
    projectId: draft.projectId,
    sessionId: draft.sessionId,
  };
  assert(draft.video.editDraft);
  await assert.rejects(
    updateMarketingVideoEditDraft(draft.videoId, draft.video.editDraft, identity, db),
    VideoRetentionError,
  );
  await assert.rejects(
    applyMarketingVideoAiDraft(draft.videoId, draft.video.editDraft, draft.actorId, 1, db),
  );
  await assert.rejects(
    beginGuardedMarketingVideoRender(draft.videoId, draft.actorId, db),
    VideoRetentionError,
  );
  for (const kind of ["render", "ai_draft"] as const)
    await assert.rejects(
      queueVideoProcessingJob(draft.videoId, kind, identity, db),
      VideoRetentionError,
    );
  assert.equal(await loadWorkspaceVideoForActor(draft.videoId, draft.actorId, db), undefined);
  assert.deepEqual(await listProjectMarketingVideoEntries(draft.projectId, db), []);
  await db.insert(schema.workspaceProjectMember).values({
    id: randomUUID(),
    projectId: active.projectId,
    userId: draft.actorId,
    role: "editor",
    createdById: active.ownerId,
  });
  await assert.rejects(
    copyMarketingVideoDraftToProject(
      draft.videoId,
      { ...identity, projectId: active.projectId },
      db,
    ),
    VideoRetentionError,
  );
  assert.deepEqual(await videoSnapshot(draft.videoId), draftBefore);
  scenarios++;

  const wait = await seedVideoReviewFixture(db),
    blocker = await pool.connect();
  let pending: ReturnType<typeof review> | undefined;
  try {
    await db
      .update(schema.aggregateRecord)
      .set({ createdAt: new Date(Date.now() - videoRetentionMilliseconds + 1500) })
      .where(eq(schema.aggregateRecord.id, wait.videoId));
    await blocker.query("BEGIN");
    await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [wait.actorId]);
    const {
      rows: [r],
    } = await blocker.query("SELECT pg_backend_pid() AS pid");
    const snapshot = await videoSnapshot(wait.videoId);
    pending = review(wait);
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await observeWait(r.pid);
    await delay(1600);
    await blocker.query("COMMIT");
    assert((await outcome) instanceof VideoRetentionError);
    assert.deepEqual(await videoSnapshot(wait.videoId), snapshot);
    scenarios++;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    if (pending) await pending.catch(() => {});
  }

  const working = await evidence(),
    original = await evidence("uploaded:pdf"),
    rights = await evidence(),
    fresh = await evidence("marketing-upload:video", new Date()),
    unsafe = await evidence();
  await db
    .update(schema.evidence)
    .set({ blobKey: `source-factory/${unsafe.id}.pdf` })
    .where(eq(schema.evidence.id, unsafe.id));
  await db.insert(schema.approval).values({
    id: randomUUID(),
    aggregateId: active.videoId,
    gate: "gate_01_truth",
    status: "approved",
    requestedByType: "human",
    requestedById: active.actorId,
    requestedAt: new Date(),
    decidedByType: "human",
    decidedById: active.actorId,
    decidedAt: new Date(),
    evidenceRef: rights.id,
  });
  const activeBefore = await videoSnapshot(active.videoId),
    originalBefore = await readEvidence(original.id),
    rightsBefore = await readEvidence(rights.id);
  const assetRef = `asset-synthetic-${randomUUID()}`,
    blobPath = `video/rendered/mvp1/${assetRef}.mp4`;
  bytes.add(blobPath);
  await db.insert(schema.videoGeneratedAsset).values({
    assetRef,
    blobPath,
    provider: "ffmpeg",
    modelId: "mvp1-editor",
    sizeBytes: 3,
    contentType: "video/mp4",
    createdAt: old(),
    videoProjectId: expired.videoId,
  });
  loseAcknowledgement = working.blobKey;
  const first = await cleanupExpiredVideoObjects(db, store);
  assert(first.failed >= 1);
  assert(!bytes.has(working.blobKey));
  assert.equal((await readEvidence(working.id)).blobKey, working.blobKey);
  const [retry] = await db
    .select()
    .from(schema.videoRetentionCleanup)
    .where(
      and(
        eq(schema.videoRetentionCleanup.objectKind, "evidence"),
        eq(schema.videoRetentionCleanup.objectRef, working.id),
      ),
    );
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempts, 1);
  await cleanupExpiredVideoObjects(db, store);
  assert.equal((await readEvidence(working.id)).blobKey, `retired/${working.id}`);
  assert(!bytes.has(blobPath));
  assert(bytes.has(fresh.blobKey));
  assert(bytes.has(original.blobKey));
  assert(bytes.has(rights.blobKey));
  assert(bytes.has(unsafe.blobKey));
  assert.deepEqual(await readEvidence(original.id), originalBefore);
  assert.deepEqual(await readEvidence(rights.id), rightsBefore);
  assert.deepEqual(await videoSnapshot(active.videoId), activeBefore);
  const purged = await videoSnapshot(expired.videoId);
  assert.deepEqual(purged.video.payload, {
    id: expired.videoId,
    retention: { purged: true, policyVersion: videoRetentionPolicyVersion },
  });
  assert.equal(purged.video.createdAt.getTime(), before.video.createdAt.getTime());
  assert.equal(purged.gates[0].notes, null);
  assert.deepEqual(purged.events, before.events);
  assert(!JSON.stringify(purged).includes("SYNTHETIC private note"));
  scenarios++;
  const deletesBefore = deleted.length;
  const third = await cleanupExpiredVideoObjects(db, store);
  assert.equal(third.objectsPurged, 0);
  assert.equal(deleted.length, deletesBefore);
  const [done] = await db
    .select()
    .from(schema.videoRetentionCleanup)
    .where(eq(schema.videoRetentionCleanup.id, retry.id));
  assert.equal(done.status, "purged");
  assert.equal(done.blobPath, null);
  await purgeVideoRetentionObject(done.id, db, store);
  assert.equal(deleted.length, deletesBefore);
  scenarios++;

  // An old marketing-only evidence reference cannot be recycled into a new product/review.
  const denied = await evidence();
  await db
    .update(schema.evidence)
    .set({ uploadedById: active.actorId })
    .where(eq(schema.evidence.id, denied.id));
  await assert.rejects(
    assertAndLinkProjectEvidence(active.projectId, [denied.id], active.actorId, db),
    VideoRetentionError,
  );
  scenarios++;

  // A previous-policy cleanup keeps its version and waits for a concurrent factory binding.
  const race = await evidence();
  const cleanupId = randomUUID();
  await db.insert(schema.videoRetentionCleanup).values({
    id: cleanupId,
    objectKind: "evidence",
    objectRef: race.id,
    blobPath: race.blobKey,
    policyVersion: "1.0.0",
    originalCreatedAt: old(),
  });
  const claim = await pool.connect();
  let purge: ReturnType<typeof purgeVideoRetentionObject> | undefined;
  try {
    await claim.query("BEGIN");
    await claim.query("SELECT id FROM evidence WHERE id=$1 FOR SHARE", [race.id]);
    const {
      rows: [r],
    } = await claim.query("SELECT pg_backend_pid() AS pid");
    purge = purgeVideoRetentionObject(cleanupId, db, store);
    await observeWait(r.pid);
    await claim.query(
      "INSERT INTO aggregate_record(id,type,state,payload,created_by_type,created_by_id) VALUES($1,'product','PRODUCT_DRAFT',$2::jsonb,'human','synthetic-retention')",
      [randomUUID(), JSON.stringify({ evidence_refs: [race.id], synthetic: true })],
    );
    await claim.query("COMMIT");
    assert.equal(await purge, "protected");
    assert(bytes.has(race.blobKey));
    scenarios++;
  } finally {
    await claim.query("ROLLBACK");
    claim.release();
    if (purge) await purge.catch(() => {});
  }

  const olderSource = await seedVideoReviewFixture(db);
  await db
    .update(schema.evidence)
    .set({ createdAt: old(), sourceLabel: "marketing-upload:image" })
    .where(eq(schema.evidence.id, olderSource.sourceRef));
  await assert.rejects(assertVideoRetentionForId(db, olderSource.videoId), VideoRetentionError);
  scenarios++;
  console.log(`PASS ${scenarios} synthetic PostgreSQL video retention scenarios; no external I/O`);
} finally {
  await pool.end();
  await closeDatabase();
}
