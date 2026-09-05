import { z } from "zod";
import { type VideoPlatform, videoPlatformSchema } from "./contracts";

export type VideoExportPreset = {
  platform: VideoPlatform;
  surface: "video" | "reels";
  version: string;
  verification: "verified" | "pending";
  sourceUrl: string;
  container: "mp4";
  videoCodec: "h264";
  audioCodec: "aac";
  width: number;
  height: number;
  fps: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  subtitlePolicy: "optional";
};

export const videoExportPresets: readonly VideoExportPreset[] = [
  {
    platform: "youtube",
    surface: "video",
    version: "2026-08",
    verification: "verified",
    sourceUrl: "https://support.google.com/youtube/answer/1722171",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    minDurationSeconds: 1,
    maxDurationSeconds: 3600,
    subtitlePolicy: "optional",
  },
  {
    platform: "tiktok",
    surface: "video",
    version: "2026-08",
    verification: "verified",
    sourceUrl: "https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    minDurationSeconds: 1,
    maxDurationSeconds: 600,
    subtitlePolicy: "optional",
  },
  {
    platform: "facebook",
    surface: "reels",
    version: "2026-08",
    verification: "verified",
    sourceUrl: "https://developers.facebook.com/documentation/video-api/guides/reels-publishing",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    minDurationSeconds: 3,
    maxDurationSeconds: 90,
    subtitlePolicy: "optional",
  },
  {
    platform: "instagram",
    surface: "reels",
    version: "2026-08",
    verification: "verified",
    sourceUrl:
      "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    minDurationSeconds: 3,
    maxDurationSeconds: 900,
    subtitlePolicy: "optional",
  },
  {
    platform: "x",
    surface: "video",
    version: "2026-08",
    verification: "verified",
    sourceUrl: "https://docs.x.com/x-api/media/quickstart/best-practices",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1280,
    height: 720,
    fps: 30,
    minDurationSeconds: 0.5,
    maxDurationSeconds: 140,
    subtitlePolicy: "optional",
  },
];

const mediaSchema = z.object({
  platform: videoPlatformSchema,
  container: z.string().min(1),
  videoCodec: z.string().min(1),
  audioCodec: z.string().min(1).nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  durationSeconds: z.number().positive(),
});

export type VideoExportViolation = {
  field: Exclude<keyof z.infer<typeof mediaSchema>, "platform">;
  actual: string | number | null;
  expected: string | number;
  remediation: "reencode" | "resize_or_crop" | "trim_or_review" | "add_audio";
};

/** Rejects media without modifying it; callers can display every failed field. */
export class VideoExportValidationError extends Error {
  constructor(
    public readonly platform: VideoPlatform,
    public readonly presetVersion: string,
    public readonly violations: readonly VideoExportViolation[],
  ) {
    super(
      `导出媒体不满足预设 ${platform}@${presetVersion}：${violations
        .map(
          (item) =>
            `${item.field}=${item.actual ?? "missing"}，要求 ${item.expected}（${item.remediation}）`,
        )
        .join("；")}`,
    );
    this.name = "VideoExportValidationError";
  }
}

export function validateVideoExport(media: z.infer<typeof mediaSchema>) {
  const value = mediaSchema.parse(media);
  const preset = videoExportPresets.find((item) => item.platform === value.platform)!;
  if (preset.verification !== "verified")
    throw new Error(`${value.platform} 导出预设尚未经官方规格核验。`);
  const violations: VideoExportViolation[] = [];
  for (const field of [
    "container",
    "videoCodec",
    "audioCodec",
    "width",
    "height",
    "fps",
  ] as const) {
    if (value[field] !== preset[field]) {
      violations.push({
        field,
        actual: value[field],
        expected: preset[field],
        remediation:
          field === "width" || field === "height"
            ? "resize_or_crop"
            : field === "audioCodec" && value.audioCodec === null
              ? "add_audio"
              : "reencode",
      });
    }
  }
  if (
    value.durationSeconds < preset.minDurationSeconds ||
    value.durationSeconds > preset.maxDurationSeconds
  ) {
    violations.push({
      field: "durationSeconds",
      actual: value.durationSeconds,
      expected: `${preset.minDurationSeconds}..${preset.maxDurationSeconds}`,
      remediation: "trim_or_review",
    });
  }
  if (violations.length)
    throw new VideoExportValidationError(value.platform, preset.version, violations);
  return preset;
}
