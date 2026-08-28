import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { auditEvent, videoJob as videoJobTable } from "@/lib/db/schema";
import type { VideoProviderId } from "./provider-capabilities";

export type VideoJobRecord = typeof videoJobTable.$inferSelect;

export type EnqueueVideoJobInput = {
  id: string;
  videoProjectId: string;
  provider: VideoProviderId;
  modelId: string;
  idempotencyKey: string;
  actorId: string;
};

function assertIdentifier(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} must not be empty`);
}

function auditValues(action: string, job: VideoJobRecord, actorId: string, now: Date, metadata: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), action, actorType: "system" as const, actorId, aggregateId: job.videoProjectId,
    subjectType: "video_job", subjectId: job.id,
    metadata: { provider: job.provider, model_id: job.modelId, attempts: job.attempts, ...metadata }, occurredAt: now,
  };
}

/** Creates a durable job once per idempotency key; no prompt, secret or media is stored here. */
export async function enqueueVideoJob(input: EnqueueVideoJobInput, database: Database = getDatabase()): Promise<VideoJobRecord> {
  assertIdentifier(input.id, "video job ID"); assertIdentifier(input.videoProjectId, "video project ID");
  assertIdentifier(input.modelId, "video model ID"); assertIdentifier(input.idempotencyKey, "video idempotency key"); assertIdentifier(input.actorId, "actor ID");
  const now = new Date();
  return database.transaction(async (tx) => {
    const [created] = await tx.insert(videoJobTable).values({
      id: input.id, videoProjectId: input.videoProjectId, provider: input.provider, modelId: input.modelId,
      idempotencyKey: input.idempotencyKey, status: "queued", attempts: 0,
    }).onConflictDoNothing({ target: videoJobTable.idempotencyKey }).returning();
    if (created) {
      await tx.insert(auditEvent).values(auditValues("video_job.queued", created, input.actorId, now));
      return created;
    }
    const [existing] = await tx.select().from(videoJobTable).where(eq(videoJobTable.idempotencyKey, input.idempotencyKey)).for("update");
    if (!existing) throw new Error("Video job idempotency lookup failed");
    if (existing.videoProjectId !== input.videoProjectId || existing.provider !== input.provider || existing.modelId !== input.modelId) {
      throw new Error("Video job idempotency key belongs to another request");
    }
    return existing;
  });
}

/** Claims one due job, including an expired worker lease, under a row lock. */
export async function claimNextVideoJob(workerId: string, maximumAttempts: number, leaseMs = 10 * 60_000, database: Database = getDatabase()): Promise<VideoJobRecord | undefined> {
  assertIdentifier(workerId, "worker ID");
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) throw new Error("maximum attempts must be a positive integer");
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new Error("lease duration must be at least one second");
  const now = new Date(); const expiresAt = new Date(now.getTime() + leaseMs);
  return database.transaction(async (tx) => {
    const [candidate] = await tx.select().from(videoJobTable).where(and(
      lte(videoJobTable.attempts, maximumAttempts - 1),
      or(
        and(eq(videoJobTable.status, "queued"), or(isNull(videoJobTable.nextAttemptAt), lte(videoJobTable.nextAttemptAt, now))),
        and(eq(videoJobTable.status, "running"), lte(videoJobTable.leaseExpiresAt, now)),
      ),
    )).orderBy(asc(videoJobTable.createdAt)).limit(1).for("update");
    if (!candidate) return undefined;
    const [claimed] = await tx.update(videoJobTable).set({ status: "running", attempts: sql`${videoJobTable.attempts} + 1`, claimedBy: workerId, claimedAt: now, leaseExpiresAt: expiresAt, nextAttemptAt: null, failureCode: null }).where(eq(videoJobTable.id, candidate.id)).returning();
    if (!claimed) throw new Error("Video job claim lost");
    await tx.insert(auditEvent).values(auditValues("video_job.claimed", claimed, workerId, now, { lease_expires_at: expiresAt.toISOString() }));
    return claimed;
  });
}

async function ownedRunningJob(jobId: string, workerId: string, database: Pick<Database, "select">) {
  const [job] = await database.select().from(videoJobTable).where(and(eq(videoJobTable.id, jobId), eq(videoJobTable.status, "running"), eq(videoJobTable.claimedBy, workerId))).for("update");
  if (!job) throw new Error("Video job is not owned by this worker or is not running");
  return job;
}

export async function completeVideoJob(jobId: string, workerId: string, resultAssetRef: string, database: Database = getDatabase()): Promise<VideoJobRecord> {
  assertIdentifier(resultAssetRef, "result asset reference"); const now = new Date();
  return database.transaction(async (tx) => {
    const job = await ownedRunningJob(jobId, workerId, tx);
    const [completed] = await tx.update(videoJobTable).set({ status: "succeeded", resultAssetRef, claimedBy: null, claimedAt: null, leaseExpiresAt: null }).where(eq(videoJobTable.id, job.id)).returning();
    if (!completed) throw new Error("Video job completion lost");
    await tx.insert(auditEvent).values(auditValues("video_job.succeeded", completed, workerId, now));
    return completed;
  });
}

export async function failVideoJob(jobId: string, workerId: string, failureCode: string, retryAt: Date | undefined, maximumAttempts: number, database: Database = getDatabase()): Promise<VideoJobRecord> {
  assertIdentifier(failureCode, "failure code");
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) throw new Error("maximum attempts must be a positive integer");
  const now = new Date();
  return database.transaction(async (tx) => {
    const job = await ownedRunningJob(jobId, workerId, tx);
    const retry = Boolean(retryAt && job.attempts < maximumAttempts);
    const [failed] = await tx.update(videoJobTable).set({ status: retry ? "queued" : "failed", failureCode, nextAttemptAt: retry ? retryAt : null, claimedBy: null, claimedAt: null, leaseExpiresAt: null }).where(eq(videoJobTable.id, job.id)).returning();
    if (!failed) throw new Error("Video job failure update lost");
    await tx.insert(auditEvent).values(auditValues(retry ? "video_job.retry_scheduled" : "video_job.failed", failed, workerId, now, { failure_code: failureCode }));
    return failed;
  });
}

export async function cancelVideoJob(jobId: string, actorId: string, database: Database = getDatabase()): Promise<VideoJobRecord> {
  const now = new Date();
  return database.transaction(async (tx) => {
    const [job] = await tx.select().from(videoJobTable).where(eq(videoJobTable.id, jobId)).for("update");
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) throw new Error("Video job cannot be cancelled");
    const [cancelled] = await tx.update(videoJobTable).set({ status: "cancelled", claimedBy: null, claimedAt: null, leaseExpiresAt: null, nextAttemptAt: null }).where(eq(videoJobTable.id, job.id)).returning();
    if (!cancelled) throw new Error("Video job cancellation lost");
    await tx.insert(auditEvent).values(auditValues("video_job.cancelled", cancelled, actorId, now));
    return cancelled;
  });
}
