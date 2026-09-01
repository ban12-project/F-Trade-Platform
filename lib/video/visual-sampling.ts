import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import type { VideoProject } from "./contracts";

const execFileAsync = promisify(execFile);

export type MarketingVisualSample = { label: string; data: Uint8Array; mediaType: string };

async function videoDuration(filePath: string, ffprobeBin: string) {
  const { stdout } = await execFileAsync(ffprobeBin, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取上传视频的时长。");
  return duration;
}

/** Extracts a small, bounded visual contact sheet for the language/vision model; it never creates video. */
export async function extractMarketingVisualSamples(
  sourceAssets: VideoProject["sourceAssets"],
  paths: ReadonlyMap<string, string>,
  ffmpegBin = process.env.FFMPEG_BIN,
  ffprobeBin = process.env.FFPROBE_BIN ?? "ffprobe",
): Promise<MarketingVisualSample[]> {
  if (!ffmpegBin?.trim()) throw new Error("AI 剪辑初稿需要配置已验证的 FFMPEG_BIN 以提取代表帧。");
  const directory = await mkdtemp(join(tmpdir(), "f-trade-video-samples-"));
  try {
    const samples: MarketingVisualSample[] = [];
    for (const source of sourceAssets.slice(0, 3)) {
      const filePath = paths.get(source.assetRef);
      if (!filePath) throw new Error("无法读取 AI 初稿所需的私有素材。");
      if (source.mediaType === "image") {
        const extension = extname(filePath).toLowerCase();
        const mediaType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
        samples.push({ label: `${source.assetRef} at 0ms`, data: new Uint8Array(await readFile(filePath)), mediaType });
        continue;
      }
      if (source.mediaType !== "video") continue;
      const duration = await videoDuration(filePath, ffprobeBin);
      const timestamps = [duration * 0.2, duration * 0.5, duration * 0.8];
      for (const [index, timestamp] of timestamps.entries()) {
        const output = join(/* turbopackIgnore: true */ directory, `${source.assetRef}-${index}.jpg`);
        await execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(timestamp), "-i", filePath, "-frames:v", "1", "-vf", "scale=640:-2", output]);
        samples.push({ label: `${source.assetRef} at ${Math.round(timestamp * 1_000)}ms`, data: new Uint8Array(await readFile(output)), mediaType: "image/jpeg" });
      }
    }
    return samples;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
