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
  codec_name: z.string().trim().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  disposition: z.object({ attached_pic: z.number().int().optional() }).optional(),
});

const productMediaFfprobeReportSchema = z.object({
  format: z.object({
    format_name: z.string().trim().min(1),
    duration: z.string().optional(),
  }),
  streams: z.array(ffprobeStreamSchema).min(1),
});

const expectedImageIdentity = {
  "image/jpeg": { codec: "mjpeg", format: "jpeg_pipe" },
  "image/png": { codec: "png", format: "png_pipe" },
  "image/webp": { codec: "webp", format: "webp_pipe" },
} as const;

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

function formatNames(value: string) {
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

/**
 * Converts a bounded ffprobe JSON report into server-derived ProductMedia
 * facts. Content type comes from the private evidence record, then is checked
 * against the actual container and primary visual codec.
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
  if (!visual.codec_name || !visual.width || !visual.height) throw new Error("媒体探测结果缺少有效画面编解码器或宽高。");

  const formats = formatNames(report.format.format_name);
  if (contentType.startsWith("image/")) {
    const expected = expectedImageIdentity[contentType as keyof typeof expectedImageIdentity];
    if (visual.codec_name !== expected.codec || !formats.has(expected.format)) {
      throw new Error("图片 Content-Type 与实际媒体格式不一致。");
    }
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

  if (!formats.has("mov") && !formats.has("mp4")) {
    throw new Error("视频 Content-Type 与实际媒体容器不一致。");
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
