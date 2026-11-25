import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import { buildMarketingAssDocument } from "./ass-subtitles";
import type { VideoRenderer, VideoRenderRequest } from "./rendering";

const execFileAsync = promisify(execFile);

export type FfmpegRendererDependencies = {
  resolvePrivateAssetPath(assetRef: string): Promise<string>;
  storeRenderedVideo(input: { filePath: string; contentType: "video/mp4" }): Promise<string>;
  ffmpegBin?: string;
  ffprobeBin?: string;
};

function concatPathLine(filePath: string) {
  return `file '${filePath.replaceAll("'", "'\\\\''")}'`;
}

function subtitleFilter(filePath: string) {
  const escaped = filePath.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
  return `subtitles=filename='${escaped}'`;
}

async function probeSource(filePath: string, ffprobeBin: string) {
  const { stdout } = await execFileAsync(
    ffprobeBin,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", filePath],
    { maxBuffer: 1024 * 1024 },
  );
  const value = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string }>;
  };
  const durationSeconds = Number(value.format?.duration);
  return {
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    hasAudio: value.streams?.some((stream) => stream.codec_type === "audio") ?? false,
  };
}

/**
 * A worker-side renderer. Source paths are resolved from private storage and
 * the finished MP4 is immediately handed back to private storage; neither is
 * exposed to browser code or public URLs.
 */
export function createFfmpegTimelineRenderer(
  dependencies: FfmpegRendererDependencies,
): VideoRenderer {
  const ffmpegBin = dependencies.ffmpegBin ?? process.env.FFMPEG_BIN;
  if (!ffmpegBin?.trim()) throw new Error("必须通过 FFMPEG_BIN 配置已验证的后端 FFmpeg 二进制。 ");
  const ffprobeBin = dependencies.ffprobeBin ?? process.env.FFPROBE_BIN ?? "ffprobe";
  return {
    async render(request: VideoRenderRequest) {
      const workspace = await mkdtemp(join(tmpdir(), "f-trade-render-"));
      try {
        const normalized: string[] = [];
        for (const [index, scene] of request.timeline.scenes.entries()) {
          const source = await dependencies.resolvePrivateAssetPath(scene.assetRef);
          if (!isAbsolute(source)) throw new Error("私有素材解析器必须返回绝对路径。 ");
          const output = join(workspace, `scene-${String(index).padStart(3, "0")}.mp4`);
          const mediaType = scene.mediaType ?? "video";
          const trimStartSeconds = scene.trimStartSeconds ?? 0;
          const sourceInfo =
            mediaType === "video"
              ? await probeSource(source, ffprobeBin)
              : { durationSeconds: null, hasAudio: false };
          if (
            sourceInfo.durationSeconds !== null &&
            trimStartSeconds + scene.durationSeconds > sourceInfo.durationSeconds + 0.05
          ) {
            throw new Error(`片段 ${scene.sceneId} 的截取区间超过源素材长度。`);
          }
          const inputArgs =
            mediaType === "image"
              ? ["-loop", "1", "-i", source]
              : ["-ss", String(trimStartSeconds), "-i", source];
          const keepSourceAudio = scene.audioMode === "source" && sourceInfo.hasAudio;
          const audioArgs = keepSourceAudio
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
          await execFileAsync(ffmpegBin, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            ...inputArgs,
            ...audioArgs,
            "-t",
            String(scene.durationSeconds),
            "-vf",
            `scale=trunc(iw*sar/2)*2:ih,setsar=1,${framing},setsar=1,fps=${request.fps}`,
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
        const concatList = join(workspace, "concat.txt");
        await writeFile(concatList, `${normalized.map(concatPathLine).join("\n")}\n`, "utf8");
        const joined = join(workspace, "joined.mp4");
        await execFileAsync(ffmpegBin, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatList,
          "-c",
          "copy",
          joined,
        ]);
        const subtitles = request.timeline.scenes.flatMap((scene) => scene.subtitles);
        const output = join(workspace, "output.mp4");
        if (subtitles.length || request.timeline.cta) {
          const { stdout } = await execFileAsync(ffmpegBin, ["-hide_banner", "-filters"]);
          if (!/\bsubtitles\b/.test(stdout))
            throw new Error(
              "当前 FFmpeg 未验证字幕烧录能力；必须部署带 libass subtitles 滤镜的构建。 ",
            );
          const subtitleFile = join(workspace, "captions.ass");
          await writeFile(subtitleFile, buildMarketingAssDocument(request), "utf8");
          await execFileAsync(ffmpegBin, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            joined,
            "-vf",
            subtitleFilter(subtitleFile),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            output,
          ]);
        } else await writeFile(output, await readFile(joined));
        return {
          assetRef: await dependencies.storeRenderedVideo({
            filePath: output,
            contentType: "video/mp4",
          }),
        };
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
  };
}
