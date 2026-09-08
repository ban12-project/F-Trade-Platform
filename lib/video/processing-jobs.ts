import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { aggregateRecord, videoProcessingJob } from "@/lib/db/schema";
import { videoProcessingFailureMessage } from "./processing-failures";

export type VideoProcessingKind = "ai_draft" | "render";
export type VideoProcessingStatus = "queued" | "running" | "succeeded" | "failed";
export type VideoProcessingSummary = {
  id: string;
  kind: VideoProcessingKind;
  status: VideoProcessingStatus;
  failureMessage: string | null;
};

export async function queueVideoProcessingJob(
  videoId: string,
  kind: VideoProcessingKind,
  actorId: string,
  database: Database = getDatabase(),
) {
  const [record] = await database
    .select({ version: aggregateRecord.version })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
    .limit(1);
  if (!record) throw new Error("营销视频不存在。");
  const requestKey = createHash("sha256")
    .update(`${videoId}:${kind}:${record.version}`)
    .digest("hex");
  const id = randomUUID();
  const inserted = await database
    .insert(videoProcessingJob)
    .values({ id, videoProjectId: videoId, kind, requestKey, createdBy: actorId })
    .onConflictDoNothing({ target: videoProcessingJob.requestKey })
    .returning();
  if (inserted[0]) return { job: inserted[0], created: true };
  const [existing] = await database
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
  const [claimed] = await database
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
  const [job] = await database
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
  const [existing] = await database
    .select()
    .from(videoProcessingJob)
    .where(eq(videoProcessingJob.id, jobId))
    .limit(1);
  if (!existing) throw new Error("视频处理任务不存在。");
  return existing;
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
