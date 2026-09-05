import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createReviewVideoExport } from "../lib/video/export-artifact";
import { inspectVideoFile, validateProbedVideoExport } from "../lib/video/media-probe";

const execFileAsync = promisify(execFile);

async function main() {
  const workspace = await mkdtemp(join(tmpdir(), "f-trade-render-inspection-"));
  try {
    const filePath = join(workspace, "synthetic.mp4");
    await execFileAsync(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1080x1920:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      filePath,
    ]);

    const measured = await inspectVideoFile(filePath, process.env.FFPROBE_BIN ?? "ffprobe");
    assert.equal(measured.container, "mp4");
    assert.equal(measured.videoCodec, "h264");
    assert.equal(measured.audioCodec, "aac");
    assert.equal(measured.width, 1080);
    assert.equal(measured.height, 1920);
    assert.equal(measured.fps, 30);
    assert.equal(validateProbedVideoExport("tiktok", measured).platform, "tiktok");
    assert.throws(() => validateProbedVideoExport("youtube", measured), /不满足/);

    const artifact = createReviewVideoExport({
      videoId: "00000000-0000-4000-8000-000000000602",
      sourceAssetRef: "asset-rendered-602",
      platform: "tiktok",
      media: measured,
      timeline: { durationSeconds: 1 },
    });
    assert.equal(artifact.status, "review_required");
    assert.equal(artifact.measured.videoCodec, "h264");
    console.log("PASS a real synthetic MP4 is measured and produces a review-only export artifact");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

void main();
