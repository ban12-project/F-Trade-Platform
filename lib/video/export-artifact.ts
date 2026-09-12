import { randomUUID } from "node:crypto";

import { z } from "zod";
import {
  type VideoExportArtifact,
  videoExportArtifactSchema,
  videoPlatformSchema,
} from "./contracts";
import { videoEncodingSchema } from "./encoding-contract";
import { type ProbedVideo, validateProbedVideoExport } from "./media-probe";
import { videoResourceMeasurementsSchema } from "./resource-measurements";

const privateAssetRef = z
  .string()
  .trim()
  .regex(/^asset-[a-z0-9][a-z0-9_-]{2,120}$/i);

export type ReviewVideoExport = VideoExportArtifact;

export const reviewVideoExportInputSchema = z
  .object({
    videoId: z.uuid(),
    sourceAssetRef: privateAssetRef,
    platform: videoPlatformSchema,
    media: z
      .object({
        container: z.literal("mp4"),
        videoCodec: z.string().trim().min(1),
        audioCodec: z.string().trim().min(1).nullable(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
        durationSeconds: z.number().positive(),
        subtitleStreamCount: z.number().int().min(0),
        encoding: videoEncodingSchema.optional(),
        resources: videoResourceMeasurementsSchema.optional(),
      })
      .strict(),
    timeline: z.object({ durationSeconds: z.number().positive() }).strict(),
  })
  .strict();

/**
 * Creates a review-only export receipt from ffprobe measurements. It contains
 * no public URL, publishing credential, or platform-side publication state.
 */
export function createReviewVideoExport(
  input: z.input<typeof reviewVideoExportInputSchema>,
): ReviewVideoExport {
  const value = reviewVideoExportInputSchema.parse(input);
  if (Math.abs(value.media.durationSeconds - value.timeline.durationSeconds) > 0.1) {
    throw new Error("导出媒体时长与已审核剪辑时间线不一致。 ");
  }
  const preset = validateProbedVideoExport(value.platform, value.media);
  return videoExportArtifactSchema.parse({
    id: randomUUID(),
    videoId: value.videoId,
    sourceAssetRef: value.sourceAssetRef,
    platform: value.platform,
    surface: preset.surface,
    presetVersion: preset.version,
    presetSourceUrl: preset.sourceUrl,
    status: "review_required",
    timelineDurationSeconds: value.timeline.durationSeconds,
    measured: {
      container: value.media.container,
      videoCodec: value.media.videoCodec,
      audioCodec: value.media.audioCodec,
      width: value.media.width,
      height: value.media.height,
      fps: value.media.fps,
      durationSeconds: value.media.durationSeconds,
      subtitleStreamCount: value.media.subtitleStreamCount,
      encoding: value.media.encoding,
      resources: value.media.resources,
    },
    createdAt: new Date().toISOString(),
  });
}

/** A human evidence reference is required before an export can enter an API draft. */
export function approveReviewVideoExport(
  exportArtifact: ReviewVideoExport,
  approvalRef: string,
): ReviewVideoExport {
  if (exportArtifact.status !== "review_required") throw new Error("只有待审核导出物可以批准。 ");
  if (!/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i.test(approvalRef))
    throw new Error("导出批准必须关联脱敏证据引用。 ");
  return videoExportArtifactSchema.parse({ ...exportArtifact, status: "approved", approvalRef });
}
