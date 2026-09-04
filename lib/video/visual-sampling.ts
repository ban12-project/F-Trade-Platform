import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import type { VideoProject } from "./contracts";
import { detectShotIntervals, frameDifferenceFilter, sceneDetectionFilter } from "./shot-analysis";
import { createMarketingShotCandidate, createScoredVideoShotCandidates, maximumMarketingVisualCandidates, type MarketingShotCandidate } from "./shot-candidates";

const execFileAsync = promisify(execFile);

export type MarketingVisualSample = { label: string; data: Uint8Array; mediaType: string };
export type MarketingVisualSampling = { candidates: MarketingShotCandidate[]; visualSamples: MarketingVisualSample[] };

async function videoDuration(filePath: string, ffprobeBin: string) {
  const { stdout } = await execFileAsync(ffprobeBin, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取上传视频的时长。");
  return duration;
}

async function analyzeVideo(filePath: string, durationMs: number, ffmpegBin: string) {
  const analyze = (filter: string) => execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-i", filePath, "-an", "-vf", filter, "-f", "null", "-"], { maxBuffer: 8 * 1024 * 1024 });
  // Run sequentially so a two-vCPU worker does not decode the same long source twice at once.
  const { stdout: sceneMetadata } = await analyze(sceneDetectionFilter());
  const { stdout: motionMetadata } = await analyze(frameDifferenceFilter());
  return detectShotIntervals({ durationMs, sceneMetadata, motionMetadata });
}

/** Extracts a small, bounded visual contact sheet for the language/vision model; it never creates video. */
export async function extractMarketingVisualSamples(
  sourceAssets: VideoProject["sourceAssets"],
  paths: ReadonlyMap<string, string>,
  ffmpegBin = process.env.FFMPEG_BIN,
  ffprobeBin = process.env.FFPROBE_BIN ?? "ffprobe",
): Promise<MarketingVisualSampling> {
  if (!ffmpegBin?.trim()) throw new Error("AI 剪辑初稿需要配置已验证的 FFMPEG_BIN 以提取代表帧。");
  const directory = await mkdtemp(join(tmpdir(), "f-trade-video-samples-"));
  try {
    const samples: MarketingVisualSample[] = [];
    const candidates: MarketingShotCandidate[] = [];
    const boundedSources = sourceAssets.slice(0, 3);
    const candidatesPerSource = Math.max(1, Math.floor(maximumMarketingVisualCandidates / Math.max(1, boundedSources.length)));
    for (const [sourceIndex, source] of boundedSources.entries()) {
      const filePath = paths.get(source.assetRef);
      if (!filePath) throw new Error("无法读取 AI 初稿所需的私有素材。");
      if (source.mediaType === "image") {
        const extension = extname(filePath).toLowerCase();
        const mediaType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
        const candidate = createMarketingShotCandidate({ sourceIndex, candidateIndex: 0, assetRef: source.assetRef, mediaType: "image", trimStartMs: 0 });
        candidates.push(candidate);
        samples.push({ label: `${candidate.id} · image · max ${candidate.maximumDurationMs}ms`, data: new Uint8Array(await readFile(filePath)), mediaType });
        continue;
      }
      if (source.mediaType !== "video") continue;
      const duration = await videoDuration(filePath, ffprobeBin);
      const durationMs = Math.round(duration * 1_000);
      const intervals = await analyzeVideo(filePath, durationMs, ffmpegBin);
      const sourceCandidates = createScoredVideoShotCandidates({ sourceIndex, assetRef: source.assetRef, sourceDurationMs: durationMs, maximumCandidates: candidatesPerSource, intervals });
      for (const [candidateIndex, candidate] of sourceCandidates.entries()) {
        const timestamp = (candidate.sourceAnalysis?.representativeMs ?? candidate.trimStartMs) / 1_000;
        const output = join(/* turbopackIgnore: true */ directory, `${source.assetRef}-${candidateIndex}.jpg`);
        await execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(timestamp), "-i", filePath, "-frames:v", "1", "-vf", "scale=640:-2", output]);
        candidates.push(candidate);
        const analysis = candidate.sourceAnalysis;
        samples.push({ label: `${candidate.id} · video · interval ${analysis?.intervalStartMs ?? candidate.trimStartMs}-${analysis?.intervalEndMs ?? candidate.trimStartMs + candidate.maximumDurationMs}ms · action ${analysis?.actionScore ?? 0}/100 · max ${candidate.maximumDurationMs}ms`, data: new Uint8Array(await readFile(output)), mediaType: "image/jpeg" });
      }
    }
    return { candidates, visualSamples: samples };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
