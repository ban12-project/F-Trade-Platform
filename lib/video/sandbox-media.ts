import { Sandbox } from "@vercel/sandbox";

import type { VideoProject } from "./contracts";
import { parseFfprobeOutput } from "./media-probe";
import type { VideoRenderRequest } from "./rendering";
import type { SandboxVideoSource } from "./sandbox-sources";
import { detectShotIntervals, frameDifferenceFilter, sceneDetectionFilter } from "./shot-analysis";
import {
  createMarketingShotCandidate,
  createScoredVideoShotCandidates,
  type MarketingShotCandidate,
  maximumMarketingSourceDurationSeconds,
  maximumMarketingVisualCandidates,
} from "./shot-candidates";
import type { MarketingVisualSample } from "./visual-sampling";

type SignedSources = ReadonlyMap<string, SandboxVideoSource>;

export { maximumMarketingSourceDurationSeconds } from "./shot-candidates";

function sandboxImage() {
  const image = process.env.VIDEO_SANDBOX_IMAGE?.trim();
  if (!image)
    throw new Error(
      "未配置 VIDEO_SANDBOX_IMAGE；Vercel 视频任务需要包含 FFmpeg、libass、H.264 和 AAC 的固定 Sandbox 镜像。",
    );
  return image;
}

async function command(sandbox: Sandbox, executable: string, args: string[]) {
  const result = await sandbox.runCommand({ cmd: executable, args, cwd: "/vercel/sandbox" });
  if (result.exitCode !== 0)
    throw new Error((await result.stderr()).trim().slice(0, 1_000) || `${executable} 执行失败。`);
  return result.stdout();
}

async function createMediaSandbox(sources: SignedSources) {
  const sandbox = await Sandbox.create({
    image: sandboxImage(),
    timeout: 10 * 60 * 1_000,
    resources: { vcpus: Number(process.env.VIDEO_SANDBOX_VCPUS ?? 2) },
    networkPolicy: { allow: [...new Set([...sources.values()].map((source) => source.hostname))] },
    persistent: false,
  });
  const filters = await command(sandbox, "ffmpeg", ["-hide_banner", "-filters"]);
  const encoders = await command(sandbox, "ffmpeg", ["-hide_banner", "-encoders"]);
  if (
    !/\bsubtitles\b/.test(filters) ||
    !/\blibx264\b/.test(encoders) ||
    !/\baac\b/.test(encoders)
  ) {
    await sandbox.stop();
    throw new Error("Sandbox FFmpeg 缺少 subtitles/libass、libx264 或 AAC 能力。");
  }
  await sandbox.fs.mkdir("/vercel/sandbox/work", { recursive: true });
  return sandbox;
}

async function downloadSources(sandbox: Sandbox, assetRefs: string[], sources: SignedSources) {
  const remote = new Map<string, string>();
  for (const [index, assetRef] of [...new Set(assetRefs)].entries()) {
    const source = sources.get(assetRef);
    if (!source) throw new Error("无法读取视频任务所需的私有素材。");
    const destination = `/vercel/sandbox/work/source-${index}${source.extension}`;
    const config = `/vercel/sandbox/work/download-${index}.conf`;
    await sandbox.fs.writeFile(
      config,
      `url = "${source.signedGetUrl}"\noutput = "${destination}"\n`,
    );
    await command(sandbox, "curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--config",
      config,
    ]);
    await sandbox.fs.rm(config, { force: true });
    remote.set(assetRef, destination);
  }
  return remote;
}

function assTime(seconds: number) {
  const value = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(value / 360000)}:${String(Math.floor((value % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((value % 6000) / 100)).padStart(2, "0")}.${String(value % 100).padStart(2, "0")}`;
}

function assText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\n", "\\N");
}

function assDocument(request: VideoRenderRequest) {
  const lines = request.timeline.scenes.flatMap((scene) =>
    scene.subtitles.map(
      (item) =>
        `Dialogue: 0,${assTime(item.startSeconds)},${assTime(item.endSeconds)},Caption,,0,0,0,,${assText(item.text)}`,
    ),
  );
  if (request.timeline.cta)
    lines.push(
      `Dialogue: 1,${assTime(request.timeline.cta.startSeconds)},${assTime(request.timeline.cta.endSeconds)},CTA,,0,0,0,,${assText(request.timeline.cta.text)}`,
    );
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${request.width}\nPlayResY: ${request.height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,DejaVu Sans,${Math.max(32, Math.round(request.height * 0.04))},&H00FFFFFF,&H000000FF,&H00111111,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,60,60,${Math.max(54, Math.round(request.height * 0.07))},1\nStyle: CTA,DejaVu Sans,${Math.max(42, Math.round(request.height * 0.055))},&H00FFFFFF,&H000000FF,&H00111111,&H90000000,-1,0,0,0,100,100,0,0,3,2,0,5,80,80,80,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join("\n")}\n`;
}

export async function extractMarketingVisualSamplesInSandbox(
  sourceAssets: VideoProject["sourceAssets"],
  sources: SignedSources,
): Promise<{ candidates: MarketingShotCandidate[]; visualSamples: MarketingVisualSample[] }> {
  const sandbox = await createMediaSandbox(sources);
  try {
    const remote = await downloadSources(
      sandbox,
      sourceAssets.map((asset) => asset.assetRef),
      sources,
    );
    const samples: MarketingVisualSample[] = [];
    const candidates: MarketingShotCandidate[] = [];
    const boundedSources = sourceAssets.slice(0, 3);
    const candidatesPerSource = Math.max(
      1,
      Math.floor(maximumMarketingVisualCandidates / Math.max(1, boundedSources.length)),
    );
    for (const [sourceIndex, source] of boundedSources.entries()) {
      const input = remote.get(source.assetRef)!;
      if (source.mediaType === "image") {
        const candidate = createMarketingShotCandidate({
          sourceIndex,
          candidateIndex: 0,
          assetRef: source.assetRef,
          mediaType: "image",
          trimStartMs: 0,
        });
        candidates.push(candidate);
        samples.push({
          label: `${candidate.id} · image · max ${candidate.maximumDurationMs}ms`,
          data: new Uint8Array(await sandbox.fs.readFile(input)),
          mediaType: sources.get(source.assetRef)!.contentType,
        });
        continue;
      }
      const rawDuration = await command(sandbox, "ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        input,
      ]);
      const duration = Number(rawDuration.trim());
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取上传视频的时长。");
      if (duration > maximumMarketingSourceDurationSeconds)
        throw new Error(`源视频不能超过 ${maximumMarketingSourceDurationSeconds} 秒。`);
      const durationMs = Math.round(duration * 1_000);
      const sceneMetadata = await command(sandbox, "ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-an",
        "-vf",
        sceneDetectionFilter(),
        "-f",
        "null",
        "-",
      ]);
      const motionMetadata = await command(sandbox, "ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-an",
        "-vf",
        frameDifferenceFilter(),
        "-f",
        "null",
        "-",
      ]);
      const intervals = detectShotIntervals({ durationMs, sceneMetadata, motionMetadata });
      const sourceCandidates = createScoredVideoShotCandidates({
        sourceIndex,
        assetRef: source.assetRef,
        sourceDurationMs: durationMs,
        maximumCandidates: candidatesPerSource,
        intervals,
      });
      for (const [frameIndex, candidate] of sourceCandidates.entries()) {
        const timestamp =
          (candidate.sourceAnalysis?.representativeMs ?? candidate.trimStartMs) / 1_000;
        const output = `/vercel/sandbox/work/sample-${sourceIndex}-${frameIndex}.jpg`;
        await command(sandbox, "ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          String(timestamp),
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-2",
          output,
        ]);
        candidates.push(candidate);
        const analysis = candidate.sourceAnalysis;
        samples.push({
          label: `${candidate.id} · video · interval ${analysis?.intervalStartMs ?? candidate.trimStartMs}-${analysis?.intervalEndMs ?? candidate.trimStartMs + candidate.maximumDurationMs}ms · action ${analysis?.actionScore ?? 0}/100 · max ${candidate.maximumDurationMs}ms`,
          data: new Uint8Array(await sandbox.fs.readFile(output)),
          mediaType: "image/jpeg",
        });
      }
    }
    return { candidates, visualSamples: samples };
  } finally {
    await sandbox.stop();
  }
}

export async function renderMarketingTimelineInSandbox(
  request: VideoRenderRequest,
  sources: SignedSources,
) {
  const sandbox = await createMediaSandbox(sources);
  try {
    const remote = await downloadSources(
      sandbox,
      request.timeline.scenes.map((scene) => scene.assetRef),
      sources,
    );
    const normalized: string[] = [];
    for (const [index, scene] of request.timeline.scenes.entries()) {
      const input = remote.get(scene.assetRef)!;
      const output = `/vercel/sandbox/work/scene-${index}.mp4`;
      let hasAudio = false;
      if (scene.mediaType === "video") {
        const probe = JSON.parse(
          await command(sandbox, "ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            input,
          ]),
        ) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
        const sourceDuration = Number(probe.format?.duration);
        if (
          Number.isFinite(sourceDuration) &&
          sourceDuration > maximumMarketingSourceDurationSeconds
        )
          throw new Error(`源视频不能超过 ${maximumMarketingSourceDurationSeconds} 秒。`);
        if (
          Number.isFinite(sourceDuration) &&
          (scene.trimStartSeconds ?? 0) + scene.durationSeconds > sourceDuration + 0.05
        )
          throw new Error(`片段 ${scene.sceneId} 的截取区间超过源素材长度。`);
        hasAudio = probe.streams?.some((stream) => stream.codec_type === "audio") ?? false;
      }
      const inputArgs =
        scene.mediaType === "image"
          ? ["-loop", "1", "-i", input]
          : ["-ss", String(scene.trimStartSeconds ?? 0), "-i", input];
      const keepAudio = scene.audioMode === "source" && hasAudio;
      const audioArgs = keepAudio
        ? ["-map", "0:v:0", "-map", "0:a:0"]
        : [
            "-f",
            "lavfi",
            "-t",
            String(scene.durationSeconds),
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
          ];
      const framing =
        scene.fitMode === "cover"
          ? `scale=${request.width}:${request.height}:force_original_aspect_ratio=increase,crop=${request.width}:${request.height}`
          : `scale=${request.width}:${request.height}:force_original_aspect_ratio=decrease,pad=${request.width}:${request.height}:(ow-iw)/2:(oh-ih)/2`;
      await command(sandbox, "ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...inputArgs,
        ...audioArgs,
        "-t",
        String(scene.durationSeconds),
        "-vf",
        `${framing},fps=${request.fps}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        // Concat requires identical audio time bases and channel layouts across clips.
        "-ar",
        "48000",
        "-ac",
        "2",
        "-shortest",
        output,
      ]);
      normalized.push(output);
    }
    const concatFile = "/vercel/sandbox/work/concat.txt";
    await sandbox.fs.writeFile(
      concatFile,
      normalized.map((path) => `file '${path}'`).join("\n") + "\n",
    );
    const joined = "/vercel/sandbox/work/joined.mp4";
    await command(sandbox, "ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c",
      "copy",
      joined,
    ]);
    const output = "/vercel/sandbox/work/output.mp4";
    if (request.timeline.scenes.some((scene) => scene.subtitles.length) || request.timeline.cta) {
      const captions = "/vercel/sandbox/work/captions.ass";
      await sandbox.fs.writeFile(captions, assDocument(request));
      await command(sandbox, "ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        joined,
        "-vf",
        `subtitles=filename='${captions}'`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        output,
      ]);
    } else await sandbox.fs.copyFile(joined, output);
    const probe = parseFfprobeOutput(
      JSON.parse(
        await command(sandbox, "ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=format_name,duration:stream=codec_type,codec_name,width,height,r_frame_rate",
          "-of",
          "json",
          output,
        ]),
      ),
    );
    return { data: new Uint8Array(await sandbox.fs.readFile(output)), probe };
  } finally {
    await sandbox.stop();
  }
}
