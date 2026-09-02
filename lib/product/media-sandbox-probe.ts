import "server-only";

import { Sandbox } from "@vercel/sandbox";

import { productMediaProbeSchema, type ProductMediaProbe } from "./media-service";
import type { SandboxVideoSource } from "../video/sandbox-sources";

const maximumProductMediaDurationSeconds = 120;

function sandboxImage() {
  const image = process.env.VIDEO_SANDBOX_IMAGE?.trim();
  if (!image) throw new Error("未配置 VIDEO_SANDBOX_IMAGE，无法安全探测产品媒体。");
  return image;
}

async function command(sandbox: Sandbox, executable: string, args: string[]) {
  const result = await sandbox.runCommand({ cmd: executable, args, cwd: "/vercel/sandbox" });
  if (result.exitCode !== 0) {
    throw new Error((await result.stderr()).trim().slice(0, 1_000) || `${executable} 执行失败。`);
  }
  return result.stdout();
}

function frameRate(value: string | undefined) {
  if (!value) return null;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null;
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

type RawProbe = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }>;
  format?: { duration?: string };
};

/**
 * Downloads one exact, short-lived private source into an isolated Sandbox and
 * derives technical metadata with ffprobe. No browser field can declare width,
 * duration, FPS, audio presence, or media type.
 */
export async function probeProductMediaEvidenceInSandbox(
  assetRef: string,
  sources: ReadonlyMap<string, SandboxVideoSource>,
): Promise<ProductMediaProbe> {
  const source = sources.get(assetRef);
  if (!source || source.assetRef !== assetRef) throw new Error("产品媒体的私有源文件不可用。");

  const sandbox = await Sandbox.create({
    image: sandboxImage(),
    timeout: 10 * 60 * 1_000,
    resources: { vcpus: Number(process.env.VIDEO_SANDBOX_VCPUS ?? 2) },
    networkPolicy: { allow: [source.hostname] },
    persistent: false,
  });
  try {
    await sandbox.fs.mkdir("/vercel/sandbox/work", { recursive: true });
    const input = `/vercel/sandbox/work/product-media${source.extension}`;
    const config = "/vercel/sandbox/work/download.conf";
    await sandbox.fs.writeFile(config, `url = "${source.signedGetUrl}"\noutput = "${input}"\n`);
    await command(sandbox, "curl", ["--fail", "--silent", "--show-error", "--location", "--config", config]);
    await sandbox.fs.rm(config, { force: true });

    const raw = JSON.parse(await command(sandbox, "ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate",
      "-of", "json",
      input,
    ])) as RawProbe;
    const visual = raw.streams?.find((stream) => stream.codec_type === "video");
    const width = Number(visual?.width);
    const height = Number(visual?.height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error("无法从私有源文件读取有效画面尺寸。");
    }

    if (source.contentType.startsWith("image/")) {
      return productMediaProbeSchema.parse({
        mediaType: "image",
        technical: {
          contentType: source.contentType,
          width,
          height,
          durationMs: null,
          fps: null,
          hasAudio: false,
        },
      });
    }
    if (!source.contentType.startsWith("video/")) throw new Error("产品媒体仅支持受控图片或视频类型。");

    const durationSeconds = Number(raw.format?.duration);
    const fps = frameRate(visual?.avg_frame_rate) ?? frameRate(visual?.r_frame_rate);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maximumProductMediaDurationSeconds) {
      throw new Error(`产品视频时长必须介于 0 和 ${maximumProductMediaDurationSeconds} 秒之间。`);
    }
    if (fps === null) throw new Error("无法从产品视频读取有效帧率。");

    return productMediaProbeSchema.parse({
      mediaType: "video",
      technical: {
        contentType: source.contentType,
        width,
        height,
        durationMs: Math.max(1, Math.round(durationSeconds * 1_000)),
        fps,
        hasAudio: raw.streams?.some((stream) => stream.codec_type === "audio") ?? false,
      },
    });
  } finally {
    await sandbox.stop();
  }
}
