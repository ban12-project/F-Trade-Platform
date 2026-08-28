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
  status: "review_required";
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
}).strict();

/**
 * Creates a review-only export receipt from ffprobe measurements. It contains
 * no public URL, publishing credential, or platform-side publication state.
 */
export function createReviewVideoExport(input: z.input<typeof reviewVideoExportInputSchema>): ReviewVideoExport {
  const value = reviewVideoExportInputSchema.parse(input);
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
