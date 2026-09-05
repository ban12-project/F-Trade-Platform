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
  container: z.literal("mp4"),
  videoCodec: z.literal("h264"),
  audioCodec: z.literal("aac"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  durationSeconds: z.number().positive(),
});
export function validateVideoExport(media: z.infer<typeof mediaSchema>) {
  const value = mediaSchema.parse(media);
  const preset = videoExportPresets.find((item) => item.platform === value.platform)!;
  if (preset.verification !== "verified")
    throw new Error(`${value.platform} 导出预设尚未经官方规格核验。`);
  if (
    value.width !== preset.width ||
    value.height !== preset.height ||
    value.fps !== preset.fps ||
    value.durationSeconds < preset.minDurationSeconds ||
    value.durationSeconds > preset.maxDurationSeconds
  )
    throw new Error("导出媒体不满足已核验平台预设。");
  return preset;
}
