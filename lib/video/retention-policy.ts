import { type SQLWrapper, sql } from "drizzle-orm";
import { z } from "zod";
import policy from "@/config/marketing-video-release-policy.json";

const retention = z.object({ days: z.number().int().positive().max(3650) }).parse(policy.retention);
export const videoRetentionDays = retention.days;
export const videoRetentionMilliseconds = videoRetentionDays * 86_400_000;
export const videoRetentionPolicyVersion = policy.version;
export const VIDEO_RETENTION_MESSAGE = "该营销视频或工作素材已超过保留期，不能继续使用。";

export class VideoRetentionError extends Error {
  constructor() {
    super(VIDEO_RETENTION_MESSAGE);
    this.name = "VideoRetentionError";
  }
}

export function isVideoObjectRetained(createdAt: Date, now = new Date()) {
  return (
    Number.isFinite(createdAt.getTime()) &&
    createdAt.getTime() + videoRetentionMilliseconds > now.getTime()
  );
}

export function assertVideoObjectRetained(createdAt: Date, now = new Date()) {
  if (!isVideoObjectRetained(createdAt, now)) throw new VideoRetentionError();
}

/** clock_timestamp also advances during transactions and lock waits. */
export function videoRetainedCondition(createdAt: SQLWrapper) {
  return sql`${createdAt} > clock_timestamp() - (${videoRetentionDays} * interval '1 day')`;
}

export function aggregateRetentionCondition(type: SQLWrapper, createdAt: SQLWrapper) {
  return sql`(${type} <> 'video' OR ${videoRetainedCondition(createdAt)})`;
}

export function isVideoWorkingEvidence(sourceLabel: string) {
  return (
    sourceLabel === "marketing-upload:image" ||
    sourceLabel === "marketing-upload:video" ||
    sourceLabel === "internet-search:wikimedia-commons:private-test-only"
  );
}

export function videoWorkingEvidenceRetainedCondition(
  sourceLabel: SQLWrapper,
  createdAt: SQLWrapper,
) {
  return sql`(${sourceLabel} NOT IN ('marketing-upload:image', 'marketing-upload:video', 'internet-search:wikimedia-commons:private-test-only') OR ${videoRetainedCondition(createdAt)})`;
}
