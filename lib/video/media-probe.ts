import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { type VideoPlatform, videoPlatformSchema } from "./contracts";
import { validateVideoExport } from "./export-presets";

const execFileAsync = promisify(execFile);

const ffprobeSchema = z.object({
  format: z.object({ format_name: z.string().min(1), duration: z.string().min(1) }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      r_frame_rate: z.string().optional(),
    }),
  ),
});

export type ProbedVideo = {
  container: "mp4";
  videoCodec: string;
  audioCodec: string | null;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  subtitleStreamCount: number;
};

function parseRate(value: string | undefined) {
  if (!value) throw new Error("ffprobe output is missing video frame rate");
  if (!/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(value))
    throw new Error("ffprobe returned an invalid video frame rate");
  const [numerator, denominator = 1] = value.split("/").map(Number);
  const fps = numerator / denominator;
  if (!Number.isFinite(fps) || fps <= 0)
    throw new Error("ffprobe returned an invalid video frame rate");
  return fps;
}

/** Parses only the minimum metadata required for export validation. */
export function parseFfprobeOutput(raw: unknown): ProbedVideo {
  const report = ffprobeSchema.parse(raw);
  if (!report.format.format_name.split(",").includes("mp4"))
    throw new Error("Only MP4 container exports are supported");
  const video = report.streams.find((stream) => stream.codec_type === "video");
  if (!video?.codec_name || !video.width || !video.height)
    throw new Error("ffprobe output is missing a valid video stream");
  const audio = report.streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(report.format.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error("ffprobe returned an invalid duration");
  return {
    container: "mp4",
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    width: video.width,
    height: video.height,
    fps: parseRate(video.r_frame_rate),
    durationSeconds,
    subtitleStreamCount: report.streams.filter((stream) => stream.codec_type === "subtitle").length,
  };
}

export async function inspectVideoFile(
  filePath: string,
  ffprobeBin = "ffprobe",
): Promise<ProbedVideo> {
  if (!filePath.trim()) throw new Error("Video file path is required");
  const { stdout } = await execFileAsync(
    ffprobeBin,
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name,duration:stream=codec_type,codec_name,width,height,r_frame_rate",
      "-of",
      "json",
      filePath,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return parseFfprobeOutput(JSON.parse(stdout));
}

/** Validates measured media rather than trusting metadata supplied by a caller. */
export function validateProbedVideoExport(platform: VideoPlatform, media: ProbedVideo) {
  const parsedPlatform = videoPlatformSchema.parse(platform);
  return validateVideoExport({
    platform: parsedPlatform,
    container: media.container,
    videoCodec: media.videoCodec,
    audioCodec: media.audioCodec,
    width: media.width,
    height: media.height,
    fps: media.fps,
    durationSeconds: media.durationSeconds,
  });
}
