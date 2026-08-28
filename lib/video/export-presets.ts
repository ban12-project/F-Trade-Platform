import { z } from "zod";
import { videoPlatformSchema, type VideoPlatform } from "./contracts";

export type VideoExportPreset = { platform: VideoPlatform; version: string; verification: "verified" | "pending"; sourceUrl: string; container: "mp4"; videoCodec: "h264"; audioCodec: "aac"; width: number; height: number; fps: number; maxDurationSeconds: number };

export const videoExportPresets: readonly VideoExportPreset[] = [
  { platform: "youtube", version: "2026-08", verification: "verified", sourceUrl: "https://support.google.com/youtube/answer/1722171", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1920, height: 1080, fps: 30, maxDurationSeconds: 3600 },
  { platform: "tiktok", version: "2026-08", verification: "verified", sourceUrl: "https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, maxDurationSeconds: 600 },
  { platform: "facebook", version: "pending", verification: "pending", sourceUrl: "", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, maxDurationSeconds: 90 },
  { platform: "instagram", version: "pending", verification: "pending", sourceUrl: "", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, maxDurationSeconds: 90 },
  { platform: "x", version: "pending", verification: "pending", sourceUrl: "", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1920, height: 1080, fps: 30, maxDurationSeconds: 140 },
];

const mediaSchema = z.object({ platform: videoPlatformSchema, container: z.literal("mp4"), videoCodec: z.literal("h264"), audioCodec: z.literal("aac"), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().int().positive(), durationSeconds: z.number().positive() });
export function validateVideoExport(media: z.infer<typeof mediaSchema>) {
  const value = mediaSchema.parse(media); const preset = videoExportPresets.find((item) => item.platform === value.platform)!;
  if (preset.verification !== "verified") throw new Error(`${value.platform} 导出预设尚未经官方规格核验。`);
  if (value.width !== preset.width || value.height !== preset.height || value.fps !== preset.fps || value.durationSeconds > preset.maxDurationSeconds) throw new Error("导出媒体不满足已核验平台预设。");
  return preset;
}
