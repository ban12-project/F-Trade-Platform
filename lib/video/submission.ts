import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord } from "@/lib/db/schema";
import { videoJobSubmissionFormSchema } from "@/lib/form-schemas";

import { videoProjectSchema } from "./contracts";
import { enqueueVideoJob } from "./job-store";
import { loadVideoExecutionConfiguration } from "./provider-config-store";
import { selectVerifiedVideoModel } from "./provider-capabilities";

export const videoJobSubmissionSchema = videoJobSubmissionFormSchema;
export type VideoJobSubmission = z.infer<typeof videoJobSubmissionSchema>;

export type SubmittedVideoJob = { id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled" };

/** Stable opaque identity for exactly-once submission of the same reviewed plan. */
export function videoJobIdempotencyKey(submission: VideoJobSubmission) {
  const value = JSON.stringify({
    videoId: submission.videoId,
    provider: submission.provider,
    modelId: submission.modelId,
    requiredCapabilities: [...submission.requiredCapabilities].sort(),
    aspectRatio: submission.aspectRatio,
    durationSeconds: submission.durationSeconds,
    resolution: submission.resolution,
    expectedCostCents: submission.expectedCostCents,
  });
  return `video-job-${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Queues one job from an approved video aggregate. It deliberately reloads all
 * policy/model facts on the server; browser input cannot enable a provider or
 * turn an unreviewed plan into a generation request.
 */
export async function submitApprovedVideoJob(
  input: VideoJobSubmission,
  actorId: string,
  database: Database = getDatabase(),
): Promise<SubmittedVideoJob> {
  const submission = videoJobSubmissionSchema.parse(input);
  if (!actorId.trim()) throw new Error("提交人标识不能为空。");
  const [record] = await database.select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, submission.videoId), eq(aggregateRecord.type, "video")));
  if (!record) throw new Error("未找到视频计划。");
  const project = videoProjectSchema.parse(record.payload);
  if (record.state !== "VIDEO_APPROVED" || project.status !== "approved") {
    throw new Error("只有已通过人工审核的视频计划可以提交生成。 ");
  }
  const configuration = await loadVideoExecutionConfiguration(database);
  selectVerifiedVideoModel(configuration.catalog, submission);
  const job = await enqueueVideoJob({
    id: randomUUID(),
    videoProjectId: submission.videoId,
    provider: submission.provider,
    modelId: submission.modelId,
    requiredCapabilities: submission.requiredCapabilities,
    aspectRatio: submission.aspectRatio,
    durationSeconds: submission.durationSeconds,
    resolution: submission.resolution,
    expectedCostCents: submission.expectedCostCents,
    idempotencyKey: videoJobIdempotencyKey(submission),
    actorId,
  }, database);
  return { id: job.id, status: job.status };
}
