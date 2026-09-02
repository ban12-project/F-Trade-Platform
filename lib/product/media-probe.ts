import { z } from "zod";

import { productMediaProbeSchema, type ProductMediaProbe } from "./media-service";

export const supportedProductMediaContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

const ffprobeStreamSchema = z.object({
  codec_type: z.string().trim().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  disposition: z.object({ attached_pic: z.number().int().optional() }).optional(),
});

const productMediaFfprobeReportSchema = z.object({
  format: z.object({ duration: z.string().optional() }).default({}),
  streams: z.array(ffprobeStreamSchema).min(1),
});

function positiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveRate(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parts = value.split("/");
  const numerator = Number(parts[0]);
  const denominator = parts.length > 1 ? Number(parts[1]) : 1;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return undefined;
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

/**
 * Converts a bounded ffprobe JSON report into server-derived ProductMedia
 * facts. Content type comes from the private evidence record, never a form.
 */
export function parseProductMediaFfprobeReport(
  contentTypeInput: unknown,
  raw: unknown,
): ProductMediaProbe {
  const contentType = supportedProductMediaContentTypeSchema.parse(contentTypeInput);
  const report = productMediaFfprobeReportSchema.parse(raw);
  const visualStreams = report.streams.filter((stream) =>
    stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  if (visualStreams.length !== 1) {
    throw new Error(visualStreams.length ? "媒体包含多个主画面轨道，必须人工转码后再登记。" : "媒体缺少可用的主画面轨道。");
  }
  const visual = visualStreams[0]!;
  if (!visual.width || !visual.height) throw new Error("媒体探测结果缺少有效宽高。");

  if (contentType.startsWith("image/")) {
    if (report.streams.some((stream) => stream.codec_type === "audio")) {
      throw new Error("图片素材不能包含音轨。");
    }
    return productMediaProbeSchema.parse({
      mediaType: "image",
      technical: {
        contentType,
        width: visual.width,
        height: visual.height,
        durationMs: null,
        fps: null,
        hasAudio: false,
      },
    });
  }

  const durationSeconds = positiveNumber(report.format.duration) ?? positiveNumber(visual.duration);
  if (!durationSeconds) throw new Error("视频探测结果缺少有效时长。");
  const fps = positiveRate(visual.avg_frame_rate) ?? positiveRate(visual.r_frame_rate);
  if (!fps) throw new Error("视频探测结果缺少有效帧率。");

  return productMediaProbeSchema.parse({
    mediaType: "video",
    technical: {
      contentType,
      width: visual.width,
      height: visual.height,
      durationMs: Math.max(1, Math.round(durationSeconds * 1_000)),
      fps: Math.round(fps * 1_000_000) / 1_000_000,
      hasAudio: report.streams.some((stream) => stream.codec_type === "audio"),
    },
  });
}
