import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { aggregateRecord, videoProcessingJob } from "@/lib/db/schema";
import { assertAggregateWorkspaceWrite } from "@/lib/workspace/access";
import {
  authorizeOwnedVideoDraft,
  parseVideoDraftIdentity,
  VideoDraftAccessError,
  type VideoDraftIdentity,
} from "./draft-write-access";
import { videoProcessingFailureMessage } from "./processing-failures";
import { assertVideoRetentionForId } from "./retention-access";

export type VideoProcessingKind = "ai_draft" | "render";
export type VideoProcessingStatus = "queued" | "running" | "succeeded" | "failed";
export type VideoProcessingSummary = {
  id: string;
  kind: VideoProcessingKind;
  status: VideoProcessingStatus;
  failureMessage: string | null;
};

export function videoProcessingRequestKey(
  videoId: string,
  kind: VideoProcessingKind,
  version: number,
) {
  return createHash("sha256").update(`${videoId}:${kind}:${version}`).digest("hex");
}

/** Human submission reserves the current writer and exact draft version atomically. */
export async function queueVideoProcessingJob(
  videoId: string,
  kind: VideoProcessingKind,
  identityInput: VideoDraftIdentity,
  database: Database = getDatabase(),
) {
  z.uuid().parse(videoId);
  z.enum(["ai_draft", "render"]).parse(kind);
  const identity = parseVideoDraftIdentity(identityInput);
  return database.transaction((tx) => queueLockedVideoProcessingJob(tx, videoId, kind, identity));
}

/** Also used inside the owning create/render transaction, before any Workflow dispatch. */
export async function queueLockedVideoProcessingJob(
  tx: DatabaseTransaction,
  videoId: string,
  kind: VideoProcessingKind,
  identity: VideoDraftIdentity,
) {
  await assertAggregateWorkspaceWrite(videoId, tx, identity.actorId);
  const [record] = await tx
    .select({ version: aggregateRecord.version, state: aggregateRecord.state })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
    .for("update");
  if (!record || !["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(record.state))
    throw new Error("当前视频状态不能提交处理任务。");
  const expiresAt = await authorizeOwnedVideoDraft(tx, identity, videoId);
  await assertVideoRetentionForId(tx, videoId);
  const requestKey = videoProcessingRequestKey(videoId, kind, record.version);
  if (expiresAt <= new Date()) throw new VideoDraftAccessError();
  const inserted = await tx
    .insert(videoProcessingJob)
    .values({
      id: randomUUID(),
      videoProjectId: videoId,
      kind,
      requestKey,
      createdBy: identity.actorId,
    })
    .onConflictDoNothing({ target: videoProcessingJob.requestKey })
    .returning();
  if (inserted[0]) return { job: inserted[0], created: true };
  const [existing] = await tx
    .select()
    .from(videoProcessingJob)
    .where(eq(videoProcessingJob.requestKey, requestKey))
    .limit(1);
  if (!existing) throw new Error("无法创建视频处理任务。");
  return { job: existing, created: false };
}

export async function reserveVideoWorkflowStart(
  jobId: string,
  claimId: string,
  database: Database = getDatabase(),
) {
  return database.transaction(async (tx) => {
    const [context] = await tx
      .select({ videoId: videoProcessingJob.videoProjectId })
      .from(videoProcessingJob)
      .where(eq(videoProcessingJob.id, jobId));
    if (!context) throw new Error("视频处理任务不存在。");
    await assertAggregateWorkspaceWrite(context.videoId, tx);
    await tx
      .select({ id: aggregateRecord.id })
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, context.videoId))
      .for("update");
    await assertVideoRetentionForId(tx, context.videoId);
    const [claimed] = await tx
      .update(videoProcessingJob)
      .set({ workflowRunId: claimId })
      .where(
        and(
          eq(videoProcessingJob.id, jobId),
          eq(videoProcessingJob.status, "queued"),
          isNull(videoProcessingJob.workflowRunId),
        ),
      )
      .returning({ id: videoProcessingJob.id });
    return Boolean(claimed);
  });
}

export async function attachVideoWorkflowRun(
  jobId: string,
  claimId: string,
  runId: string,
  database: Database = getDatabase(),
) {
  const [attached] = await database
    .update(videoProcessingJob)
    .set({ workflowRunId: runId })
    .where(and(eq(videoProcessingJob.id, jobId), eq(videoProcessingJob.workflowRunId, claimId)))
    .returning({ id: videoProcessingJob.id });
  if (!attached) throw new Error("视频处理任务的 Workflow 启动所有权已发生变化。");
}

export async function releaseVideoWorkflowStart(
  jobId: string,
  claimId: string,
  database: Database = getDatabase(),
) {
  await database
    .update(videoProcessingJob)
    .set({ workflowRunId: null })
    .where(
      and(
        eq(videoProcessingJob.id, jobId),
        eq(videoProcessingJob.status, "queued"),
        eq(videoProcessingJob.workflowRunId, claimId),
      ),
    );
}

export async function markVideoJobRunning(jobId: string, database: Database = getDatabase()) {
  return database.transaction(async (tx) => {
    const [context] = await tx
      .select({ videoId: videoProcessingJob.videoProjectId })
      .from(videoProcessingJob)
      .where(eq(videoProcessingJob.id, jobId));
    if (!context) throw new Error("视频处理任务不存在。");
    await assertAggregateWorkspaceWrite(context.videoId, tx);
    await tx
      .select({ id: aggregateRecord.id })
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, context.videoId))
      .for("update");
    await assertVideoRetentionForId(tx, context.videoId);
    const [job] = await tx
      .update(videoProcessingJob)
      .set({
        status: "running",
        startedAt: new Date(),
        attempts: sql`${videoProcessingJob.attempts} + 1`,
        failureCode: null,
        failureMessage: null,
      })
      .where(and(eq(videoProcessingJob.id, jobId), eq(videoProcessingJob.status, "queued")))
      .returning();
    if (job) return job;
    const [existing] = await tx
      .select()
      .from(videoProcessingJob)
      .where(eq(videoProcessingJob.id, jobId))
      .limit(1);
    if (!existing) throw new Error("视频处理任务不存在。");
    return existing;
  });
}

export async function completeVideoJob(jobId: string, database: Database = getDatabase()) {
  await database
    .update(videoProcessingJob)
    .set({ status: "succeeded", completedAt: new Date(), failureCode: null, failureMessage: null })
    .where(and(eq(videoProcessingJob.id, jobId), eq(videoProcessingJob.status, "running")));
}

export async function failVideoJob(
  jobId: string,
  code: string,
  database: Database = getDatabase(),
) {
  await database.transaction(async (tx) => {
    const [context] = await tx
      .select({ videoId: videoProcessingJob.videoProjectId })
      .from(videoProcessingJob)
      .where(eq(videoProcessingJob.id, jobId));
    if (!context) return;
    await tx
      .select({ id: aggregateRecord.id })
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, context.videoId))
      .for("update");
    const [failed] = await tx
      .update(videoProcessingJob)
      .set({
        status: "failed",
        completedAt: new Date(),
        failureCode: code,
        failureMessage: videoProcessingFailureMessage(code),
      })
      .where(and(eq(videoProcessingJob.id, jobId), eq(videoProcessingJob.status, "running")))
      .returning({ videoProjectId: videoProcessingJob.videoProjectId });
    if (failed)
      await tx
        .update(aggregateRecord)
        .set({ version: sql`${aggregateRecord.version} + 1` })
        .where(eq(aggregateRecord.id, failed.videoProjectId));
  });
}

export async function latestVideoProcessingJobs(
  videoIds: string[],
  database: Database = getDatabase(),
) {
  if (!videoIds.length) return new Map<string, VideoProcessingSummary>();
  const rows = await database
    .select()
    .from(videoProcessingJob)
    .where(inArray(videoProcessingJob.videoProjectId, videoIds))
    .orderBy(desc(videoProcessingJob.createdAt));
  const result = new Map<string, VideoProcessingSummary>();
  for (const row of rows)
    if (!result.has(row.videoProjectId)) {
      result.set(row.videoProjectId, {
        id: row.id,
        kind: row.kind,
        status: row.status,
        failureMessage:
          row.status === "failed" ? videoProcessingFailureMessage(row.failureCode) : null,
      });
    }
  return result;
}
