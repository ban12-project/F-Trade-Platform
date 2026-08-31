import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import type { VideoRenderer, VideoRenderRequest } from "./rendering";

const execFileAsync = promisify(execFile);

export type FfmpegRendererDependencies = {
  resolvePrivateAssetPath(assetRef: string): Promise<string>;
  storeRenderedVideo(input: { filePath: string; contentType: "video/mp4" }): Promise<string>;
  ffmpegBin?: string;
};

function srtTimestamp(seconds: number) {
  const milliseconds = Math.round(seconds * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milliseconds % 1_000).padStart(3, "0")}`;
}

function concatPathLine(filePath: string) {
  return `file '${filePath.replaceAll("'", "'\\\\''")}'`;
}

function subtitleFilter(filePath: string) {
  const escaped = filePath.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
  return `subtitles=filename='${escaped}'`;
}

/**
 * A worker-side renderer. Source paths are resolved from private storage and
 * the finished MP4 is immediately handed back to private storage; neither is
 * exposed to browser code or public URLs.
 */
export function createFfmpegTimelineRenderer(dependencies: FfmpegRendererDependencies): VideoRenderer {
  const ffmpegBin = dependencies.ffmpegBin ?? process.env.FFMPEG_BIN;
  if (!ffmpegBin?.trim()) throw new Error("必须通过 FFMPEG_BIN 配置已验证的后端 FFmpeg 二进制。 ");
  return {
    async render(request: VideoRenderRequest) {
      const workspace = await mkdtemp(join(tmpdir(), "f-trade-render-"));
      try {
        const normalized: string[] = [];
        for (const [index, scene] of request.timeline.scenes.entries()) {
          const source = await dependencies.resolvePrivateAssetPath(scene.assetRef);
          if (!isAbsolute(source)) throw new Error("私有素材解析器必须返回绝对路径。 ");
          const output = join(workspace, `scene-${String(index).padStart(3, "0")}.mp4`);
          await execFileAsync(ffmpegBin, [
            "-hide_banner", "-loglevel", "error", "-y", "-i", source,
            "-f", "lavfi", "-t", String(scene.durationSeconds), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-t", String(scene.durationSeconds), "-map", "0:v:0", "-map", "1:a:0",
            "-vf", `scale=${request.width}:${request.height}:force_original_aspect_ratio=decrease,pad=${request.width}:${request.height}:(ow-iw)/2:(oh-ih)/2,fps=${request.fps}`,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", output,
          ]);
          normalized.push(output);
        }
        const concatList = join(workspace, "concat.txt");
        await writeFile(concatList, `${normalized.map(concatPathLine).join("\n")}\n`, "utf8");
        const joined = join(workspace, "joined.mp4");
        await execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", joined]);
        const subtitles = request.timeline.scenes.flatMap((scene) => scene.subtitles);
        const output = join(workspace, "output.mp4");
        if (subtitles.length) {
          const { stdout } = await execFileAsync(ffmpegBin, ["-hide_banner", "-filters"]);
          if (!/\bsubtitles\b/.test(stdout)) throw new Error("当前 FFmpeg 未验证字幕烧录能力；必须部署带 libass subtitles 滤镜的构建。 ");
          const subtitleFile = join(workspace, "captions.srt");
          await writeFile(subtitleFile, subtitles.map((subtitle, index) => `${index + 1}\n${srtTimestamp(subtitle.startSeconds)} --> ${srtTimestamp(subtitle.endSeconds)}\n${subtitle.text.replaceAll("\n", " ")}\n`).join("\n"), "utf8");
          await execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-y", "-i", joined, "-vf", subtitleFilter(subtitleFile), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", output]);
        } else await writeFile(output, await readFile(joined));
        return { assetRef: await dependencies.storeRenderedVideo({ filePath: output, contentType: "video/mp4" }) };
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
  };
}
