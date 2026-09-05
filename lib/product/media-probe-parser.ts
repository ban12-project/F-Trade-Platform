import { type ProductMediaProbe, productMediaProbeSchema } from "./media-service";

export const maximumProductMediaDurationSeconds = 120;

export type RawProductMediaProbe = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }>;
  format?: { duration?: string };
};

function frameRate(value: string | undefined) {
  if (!value) return null;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  )
    return null;
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Converts raw ffprobe JSON plus the verified evidence Content-Type into governed technical metadata. */
export function parseProductMediaProbeOutput(
  raw: RawProductMediaProbe,
  contentType: string,
): ProductMediaProbe {
  const visual = raw.streams?.find((stream) => stream.codec_type === "video");
  const width = Number(visual?.width);
  const height = Number(visual?.height);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("无法从私有源文件读取有效画面尺寸。");
  }

  if (contentType.startsWith("image/")) {
    return productMediaProbeSchema.parse({
      mediaType: "image",
      technical: {
        contentType,
        width,
        height,
        durationMs: null,
        fps: null,
        hasAudio: false,
      },
    });
  }
  if (!contentType.startsWith("video/")) throw new Error("产品媒体仅支持受控图片或视频类型。");

  const durationSeconds = Number(raw.format?.duration);
  const fps = frameRate(visual?.avg_frame_rate) ?? frameRate(visual?.r_frame_rate);
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > maximumProductMediaDurationSeconds
  ) {
    throw new Error(`产品视频时长必须介于 0 和 ${maximumProductMediaDurationSeconds} 秒之间。`);
  }
  if (fps === null) throw new Error("无法从产品视频读取有效帧率。");

  return productMediaProbeSchema.parse({
    mediaType: "video",
    technical: {
      contentType,
      width,
      height,
      durationMs: Math.max(1, Math.round(durationSeconds * 1_000)),
      fps,
      hasAudio: raw.streams?.some((stream) => stream.codec_type === "audio") ?? false,
    },
  });
}
