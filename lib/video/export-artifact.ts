import { randomUUID } from "node:crypto";

import { z } from "zod";

import { videoPlatformSchema } from "./contracts";
import { type ProbedVideo, validateProbedVideoExport } from "./media-probe";

const privateAssetRef = z.string().trim().regex(/^asset-[a-z0-9][a-z0-9_-]{2,120}$/i);

export type ReviewVideoExport = {
  id: string;
  videoId: string;
  sourceAssetRef: string;
  platform: z.infer<typeof videoPlatformSchema>;
  surface: "video" | "reels";
  presetVersion: string;
  presetSourceUrl: string;
  status: "review_required" | "approved";
  approvalRef?: string;
  timelineDurationSeconds?: number;
  measured: Pick<ProbedVideo, "width" | "height" | "fps" | "durationSeconds" | "subtitleStreamCount">;
  createdAt: string;
};

export const reviewVideoExportInputSchema = z.object({
  videoId: z.uuid(),
  sourceAssetRef: privateAssetRef,
  platform: videoPlatformSchema,
  media: z.object({
    container: z.literal("mp4"),
    videoCodec: z.string().trim().min(1),
    audioCodec: z.string().trim().min(1).nullable(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    durationSeconds: z.number().positive(),
    subtitleStreamCount: z.number().int().min(0),
  }).strict(),
  timeline: z.object({ durationSeconds: z.number().positive() }).strict().optional(),
}).strict();

/**
 * Creates a review-only export receipt from ffprobe measurements. It contains
 * no public URL, publishing credential, or platform-side publication state.
 */
export function createReviewVideoExport(input: z.input<typeof reviewVideoExportInputSchema>): ReviewVideoExport {
  const value = reviewVideoExportInputSchema.parse(input);
  if (value.timeline && Math.abs(value.media.durationSeconds - value.timeline.durationSeconds) > 0.1) {
    throw new Error("导出媒体时长与已审核剪辑时间线不一致。 ");
  }
  const preset = validateProbedVideoExport(value.platform, value.media);
  return {
    id: randomUUID(),
    videoId: value.videoId,
    sourceAssetRef: value.sourceAssetRef,
    platform: value.platform,
    surface: preset.surface,
    presetVersion: preset.version,
    presetSourceUrl: preset.sourceUrl,
    status: "review_required",
    ...(value.timeline ? { timelineDurationSeconds: value.timeline.durationSeconds } : {}),
    measured: {
      width: value.media.width,
      height: value.media.height,
      fps: value.media.fps,
      durationSeconds: value.media.durationSeconds,
      subtitleStreamCount: value.media.subtitleStreamCount,
    },
    createdAt: new Date().toISOString(),
  };
}

/** A human evidence reference is required before an export can enter an API draft. */
export function approveReviewVideoExport(exportArtifact: ReviewVideoExport, approvalRef: string): ReviewVideoExport {
  if (exportArtifact.status !== "review_required") throw new Error("只有待审核导出物可以批准。 ");
  if (!/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i.test(approvalRef)) throw new Error("导出批准必须关联脱敏证据引用。 ");
  return { ...exportArtifact, status: "approved", approvalRef };
}
