import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ZodError } from "zod";
import { closeDatabase, type Database, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { assertPublicationEligible } from "../lib/social/publication-store";
import { queueVideoProcessingJob } from "../lib/video/processing-jobs";
import { decideGuardedVideoReview } from "../lib/video/product-media-guarded-operations";
import { cleanupExpiredVideoObjects } from "../lib/video/retention-cleanup";
import { VideoRetentionError, videoRetentionMilliseconds } from "../lib/video/retention-policy";
import { getMarketingVideoEditProject, updateMarketingVideoEditDraft } from "../lib/video/store";
import { loadWorkspaceVideoForActor } from "../lib/video/workspace-access";
import { seedVideoReviewFixture } from "../tests/fixtures/video-review";

// Own the entire synthetic server. Never accept an existing database URL or restore target.
const engine = process.env.CONTAINER_ENGINE ?? "docker";
assert(["docker", "podman"].includes(engine), "Use docker or podman");
const engineArgs =
  engine === "podman" && process.env.FTRADE_PODMAN_CONNECTION
    ? ["--connection", process.env.FTRADE_PODMAN_CONNECTION]
    : [];
const execute = promisify(execFile);
async function containerCommand(...args: string[]) {
  const result = await execute(engine, [...engineArgs, ...args], {
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}
const name = `ftrade-retention-restore-${randomUUID()}`;
const sourceName = "f_trade_retention_source_test";
const image = process.env.VIDEO_RETENTION_POSTGRES_IMAGE ?? "docker.io/library/postgres:17";
assert(
  ["docker.io/library/postgres:17", "public.ecr.aws/docker/library/postgres:17"].includes(image),
  "Use PostgreSQL 17 from Docker Official Images or its ECR mirror",
);
const directory = await mkdtemp(join(tmpdir(), "ftrade-retention-synthetic-"));
const files = new Map<string, string>();
function localFile(path: string) {
  const file = files.get(path);
  assert(file, "Read only a registered synthetic object");
  return file;
}
const deletes: string[] = [];
let loseAcknowledgement: string | undefined;
let port: string;
globalThis.fetch = async () => {
  throw new Error("Outbound fetch forbidden in synthetic restore drill");
};
const store = {
  async delete(path: string) {
    const file = files.get(path);
    assert(file, "Delete only a registered synthetic object");
    await rm(file, { force: true });
    deletes.push(path);
    if (loseAcknowledgement === path) {
      loseAcknowledgement = undefined;
      throw new Error("SYNTHETIC lost deletion acknowledgement");
    }
  },
};
async function object(path: string) {
  const file = join(directory, createHash("sha256").update(path).digest("hex"));
  files.set(path, file);
  await writeFile(file, "SYNTHETIC retention bytes");
}
async function database(name: string) {
  await closeDatabase();
  process.env.DATABASE_URL = `postgresql://synthetic:synthetic@127.0.0.1:${port}/${name}`;
  process.env.DATABASE_TRANSPORT = "postgres";
  return getDatabase();
}
async function dump(label: string) {
  await containerCommand(
    "exec",
    name,
    "pg_dump",
    "-U",
    "synthetic",
    "-d",
    sourceName,
    "--format=custom",
    "--file",
    `/tmp/${label}.dump`,
  );
}
async function restore(label: string) {
  const target = `f_trade_retention_${label}_test`;
  await containerCommand("exec", name, "createdb", "-U", "synthetic", target);
  await containerCommand(
    "exec",
    name,
    "pg_restore",
    "-U",
    "synthetic",
    "-d",
    target,
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    `/tmp/${label}.dump`,
  );
  const db = await database(target);
  assert.equal((await db.execute(sql`SELECT current_database() AS name`)).rows[0].name, target);
  return db;
}
async function evidence(db: Database, label: string, createdAt: Date) {
  const id = `evidence-synthetic-restore-${randomUUID()}`;
  const blobKey = `evidence/${id}/synthetic.txt`;
  await object(blobKey);
  await db.insert(schema.evidence).values({
    id,
    blobKey,
    sourceLabel: label,
    createdAt,
    contentType: "text/plain",
    sizeBytes: 25,
    sha256: "a".repeat(64),
    classification: "internal",
    uploadedByType: "system",
    uploadedById: "synthetic-restore",
  });
  return { id, blobKey };
}
async function snapshot(db: Database) {
  return {
    aggregates: await db.select().from(schema.aggregateRecord).orderBy(schema.aggregateRecord.id),
    evidence: await db.select().from(schema.evidence).orderBy(schema.evidence.id),
    assets: await db
      .select()
      .from(schema.videoGeneratedAsset)
      .orderBy(schema.videoGeneratedAsset.assetRef),
    gates: await db.select().from(schema.approval).orderBy(schema.approval.id),
    events: await db.select().from(schema.workflowEvent).orderBy(schema.workflowEvent.id),
    audits: await db.select().from(schema.auditEvent).orderBy(schema.auditEvent.id),
    cleanup: await db
      .select()
      .from(schema.videoRetentionCleanup)
      .orderBy(schema.videoRetentionCleanup.id),
    jobs: await db.select().from(schema.videoProcessingJob).orderBy(schema.videoProcessingJob.id),
    publications: await db
      .select()
      .from(schema.socialPublication)
      .orderBy(schema.socialPublication.id),
    browserJobs: await db
      .select()
      .from(schema.socialBrowserJob)
      .orderBy(schema.socialBrowserJob.id),
    channels: await db
      .select()
      .from(schema.socialChannelControl)
      .orderBy(schema.socialChannelControl.id),
  };
}
const identity = (f: Awaited<ReturnType<typeof seedVideoReviewFixture>>) => ({
  actorId: f.actorId,
  projectId: f.projectId,
  sessionId: f.sessionId,
});
try {
  await containerCommand(
    "run",
    "--detach",
    "--name",
    name,
    "--label",
    "ftrade.synthetic=retention-restore",
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    "POSTGRES_USER=synthetic",
    "--env",
    "POSTGRES_PASSWORD=synthetic",
    "--env",
    `POSTGRES_DB=${sourceName}`,
    image,
  );
  const mapping = await containerCommand("port", name, "5432/tcp");
  const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
  assert(match, "PostgreSQL must bind only a random loopback port");
  port = match[1];
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      // Image initialization briefly starts a socket-only server before its final TCP server.
      await containerCommand(
        "exec",
        name,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "synthetic",
        "-d",
        sourceName,
      );
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert(ready, "Synthetic PostgreSQL startup deadline");
  const db = await database(sourceName);
  console.log(
    `PostgreSQL ${(await db.execute(sql`SHOW server_version`)).rows[0].server_version}; ${image}`,
  );
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  const active = await seedVideoReviewFixture(db);
  const draft = await seedVideoReviewFixture(db);
  const review = await seedVideoReviewFixture(db);
  const publish = await seedVideoReviewFixture(db);
  await decideGuardedVideoReview(
    {
      videoId: publish.videoId,
      decision: "approved",
      evidenceRef: publish.decisionRef,
      notes: "SYNTHETIC retention review note",
    },
    identity(publish),
    db,
  );
  await db
    .update(schema.aggregateRecord)
    .set({
      state: "VIDEO_DRAFT",
      payload: {
        ...draft.video,
        status: "draft",
        renderedAssetRef: undefined,
        exportArtifact: undefined,
        approvalRefs: [],
      },
    })
    .where(eq(schema.aggregateRecord.id, draft.videoId));
  // Only synthetic timestamps are moved across the policy boundary, before taking backups.
  const old = new Date(Date.now() - videoRetentionMilliseconds - 60_000);
  for (const f of [draft, review, publish])
    await db
      .update(schema.aggregateRecord)
      .set({ createdAt: old })
      .where(eq(schema.aggregateRecord.id, f.videoId));
  const working = await evidence(db, "marketing-upload:image", old);
  const source = await evidence(db, "uploaded:pdf", old);
  const historical = await evidence(db, "marketing-upload:image", old);
  await db.insert(schema.auditEvent).values({
    id: randomUUID(),
    aggregateId: active.productId,
    action: "synthetic.source_bound",
    actorType: "system",
    actorId: "synthetic-restore",
    subjectType: "product",
    subjectId: active.productId,
    metadata: { evidence_ref: historical.id },
    occurredAt: old,
  });
  const assetRef = `asset-synthetic-${randomUUID()}`;
  const blobPath = `video/rendered/mvp1/${assetRef}.mp4`;
  await object(blobPath);
  await db.insert(schema.videoGeneratedAsset).values({
    assetRef,
    blobPath,
    videoProjectId: review.videoId,
    provider: "ffmpeg",
    modelId: "mvp1-editor",
    contentType: "video/mp4",
    sizeBytes: 25,
    createdAt: old,
  });
  await db.insert(schema.videoProcessingJob).values({
    id: randomUUID(),
    videoProjectId: draft.videoId,
    kind: "render",
    status: "queued",
    requestKey: `synthetic-restore-${randomUUID()}`,
    createdBy: draft.actorId,
  });
  const channelRef = `synthetic-restore-${randomUUID()}`;
  const accountRef = `synthetic-account-${randomUUID()}`;
  await db.insert(schema.socialChannelControl).values({
    id: randomUUID(),
    channelRef,
    accountRef,
    enabled: true,
    circuitStatus: "active",
    changedBy: publish.actorId,
    changedAt: new Date(),
  });
  const jobId = randomUUID();
  await db.insert(schema.socialBrowserJob).values({
    id: jobId,
    channelRef,
    accountRef,
    kind: "publish",
    status: "paused",
    idempotencyKey: `synthetic-restore-${randomUUID()}`,
    payloadRef: publish.videoId,
    failureCode: "PUBLICATION_RESULT_UNKNOWN",
  });
  await db.insert(schema.socialPublication).values({
    id: randomUUID(),
    projectId: publish.projectId,
    channelRef,
    accountRef,
    contentRef: publish.videoId,
    format: "video",
    confirmationRef: "synthetic-confirmation",
    browserJobId: jobId,
    status: "unknown",
  });
  const before = await snapshot(db);
  await dump("before_cleanup");
  loseAcknowledgement = working.blobKey;
  const interrupted = await cleanupExpiredVideoObjects(db, store);
  assert.deepEqual(interrupted, { videosPurged: 3, objectsPurged: 1, protected: 0, failed: 1 });
  const pending = await snapshot(db);
  const pendingJob = pending.cleanup.find((r) => r.objectRef === working.id);
  assert(pendingJob);
  assert.equal(pendingJob.status, "pending");
  assert.equal(pendingJob.attempts, 1);
  // Existing historical jobs keep their policy version through restore and retry.
  await db
    .update(schema.videoRetentionCleanup)
    .set({ policyVersion: "1.0.0" })
    .where(eq(schema.videoRetentionCleanup.id, pendingJob.id));
  const pendingBackup = await snapshot(db);
  await dump("pending_cleanup");
  assert.deepEqual(await cleanupExpiredVideoObjects(db, store), {
    videosPurged: 0,
    objectsPurged: 1,
    protected: 0,
    failed: 0,
  });
  for (const path of [working.blobKey, blobPath])
    await assert.rejects(readFile(localFile(path)), { code: "ENOENT" });
  console.log(
    "PASS original cleanup: actual synthetic files removed; lost acknowledgement retained in backup",
  );

  for (const [label, expected] of [
    ["before_cleanup", before],
    ["pending_cleanup", pendingBackup],
  ] as const) {
    const restored = await restore(label);
    assert.deepEqual(
      await snapshot(restored),
      expected,
      "pg_dump/pg_restore preserves complete fixture rows",
    );
    const unchanged = await snapshot(restored);
    for (const f of [draft, review, publish]) {
      await assert.rejects(getMarketingVideoEditProject(f.videoId, restored), VideoRetentionError);
      assert.equal(await loadWorkspaceVideoForActor(f.videoId, f.actorId, restored), undefined);
    }
    // A purged payload can fail schema validation before the age guard. Both must fail closed.
    const deniedWriteError =
      label === "before_cleanup"
        ? VideoRetentionError
        : (error: unknown) => error instanceof VideoRetentionError || error instanceof ZodError;
    assert(draft.video.editDraft);
    await assert.rejects(
      updateMarketingVideoEditDraft(
        draft.videoId,
        draft.video.editDraft,
        identity(draft),
        restored,
      ),
      deniedWriteError,
    );
    await assert.rejects(
      queueVideoProcessingJob(draft.videoId, "render", identity(draft), restored),
      deniedWriteError,
    );
    await assert.rejects(
      decideGuardedVideoReview(
        {
          videoId: review.videoId,
          decision: "approved",
          evidenceRef: review.decisionRef,
          notes: "SYNTHETIC must not write",
        },
        identity(review),
        restored,
      ),
      deniedWriteError,
    );
    await assert.rejects(
      restored.transaction((tx) =>
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
      deniedWriteError,
    );
    assert(
      await getMarketingVideoEditProject(active.videoId, restored),
      "Fresh restored record remains readable",
    );
    assert.deepEqual(
      await snapshot(restored),
      unchanged,
      "Denied operations must not mutate restored records",
    );
    const recovered = await cleanupExpiredVideoObjects(restored, store);
    assert.deepEqual(recovered, {
      videosPurged: label === "before_cleanup" ? 3 : 0,
      objectsPurged: label === "before_cleanup" ? 2 : 1,
      protected: 0,
      failed: 0,
    });
    const after = await snapshot(restored);
    assert.equal(after.cleanup.length, 5);
    assert(after.cleanup.every((r) => r.status === "purged" && r.blobPath === null));
    for (const job of after.cleanup) assert.deepEqual(job.originalCreatedAt, old);
    assert.equal(after.assets[0].blobPath, `retired/${assetRef}`);
    assert.equal(after.assets[0].sizeBytes, 0);
    assert.deepEqual(after.assets[0].createdAt, old);
    const retiredEvidence = after.evidence.find((r) => r.id === working.id);
    assert(retiredEvidence);
    assert.equal(retiredEvidence.blobKey, `retired/${working.id}`);
    assert.equal(retiredEvidence.sizeBytes, 0);
    assert.deepEqual(retiredEvidence.createdAt, old);
    for (const f of [draft, review, publish]) {
      const row = after.aggregates.find((r) => r.id === f.videoId);
      assert(row);
      assert.deepEqual(row.createdAt, old, "Restore/cleanup must not extend original expiry");
      assert.deepEqual(Object.keys(row.payload).sort(), ["id", "retention"]);
      assert.equal((row.payload.retention as { purged: boolean }).purged, true);
    }
    assert.equal(after.jobs[0].status, "failed");
    assert.equal(after.jobs[0].failureCode, "RETENTION_EXPIRED");
    assert.deepEqual(after.events, before.events, "Historical transitions are immutable");
    assert.deepEqual(after.publications, before.publications, "Unknown publication stays unknown");
    assert.deepEqual(after.browserJobs, before.browserJobs, "No publication retry is enqueued");
    assert.deepEqual(after.channels, before.channels);
    for (const event of before.audits)
      assert.deepEqual(
        after.audits.find((row) => row.id === event.id),
        event,
      );
    assert.equal(
      after.audits.filter((r) => r.action === "video_retention.payload_purged").length,
      3,
    );
    assert(after.gates.every((r) => r.notes === null));
    for (const row of before.aggregates.filter(
      (r) => r.type !== "video" || r.id === active.videoId,
    ))
      assert.deepEqual(
        after.aggregates.find((r) => r.id === row.id),
        row,
      );
    for (const row of before.evidence.filter((r) => r.id !== working.id))
      assert.deepEqual(
        after.evidence.find((r) => r.id === row.id),
        row,
      );
    for (const path of [source.blobKey, historical.blobKey])
      assert.equal(await readFile(localFile(path), "utf8"), "SYNTHETIC retention bytes");
    if (label === "pending_cleanup") {
      const retried = after.cleanup.find((r) => r.id === pendingJob.id);
      assert(retried);
      assert.equal(retried.policyVersion, "1.0.0");
      assert.equal(retried.attempts, 2);
      assert.deepEqual(retried.originalCreatedAt, old);
    }
    const deleteCount = deletes.length;
    assert.deepEqual(await cleanupExpiredVideoObjects(restored, store), {
      videosPurged: 0,
      objectsPurged: 0,
      protected: 0,
      failed: 0,
    });
    assert.equal(deletes.length, deleteCount);
    assert.deepEqual(await snapshot(restored), after, "Repeated cleanup is a complete no-op");
    console.log(
      `PASS ${label}: restored expiry denied, cleanup recovered, sources/history/unknown outcome preserved`,
    );
  }
} finally {
  try {
    await closeDatabase();
  } finally {
    try {
      await containerCommand("rm", "--force", "--volumes", name);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
console.log(
  "PASS two real PostgreSQL restores; own synthetic container, dumps and local files removed",
);
