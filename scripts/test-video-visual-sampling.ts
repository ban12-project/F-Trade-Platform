import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { extractMarketingVisualSamples } from "../lib/video/visual-sampling";
import { maximumMarketingSourceDurationSeconds, maximumMarketingVisualCandidates, videoShotCandidateStarts } from "../lib/video/shot-candidates";

const execFileAsync = promisify(execFile);

void (async () => {
  const ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg";
  const ffprobeBin = process.env.FFPROBE_BIN ?? "ffprobe";
  const directory = await mkdtemp(join(tmpdir(), "f-trade-visual-sampling-test-"));
  try {
    const source = join(directory, "source.mp4");
    await execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    const sampling = await extractMarketingVisualSamples(
      [{ assetRef: "evidence-video-sample", mediaType: "video", rightsEvidenceRef: "evidence-rights-sample" }],
      new Map([["evidence-video-sample", source]]),
      ffmpegBin,
      ffprobeBin,
    );
    assert.equal(sampling.visualSamples.length, 3);
    assert.equal(sampling.candidates.length, 3);
    assert.ok(sampling.visualSamples.every((sample) => sample.mediaType === "image/jpeg" && sample.data.byteLength > 0));
    assert.deepEqual(sampling.candidates.map(({ id, trimStartMs, maximumDurationMs }) => ({ id, trimStartMs, maximumDurationMs })), [
      { id: "shot-001-001", trimStartMs: 1_000, maximumDurationMs: 4_000 },
      { id: "shot-001-002", trimStartMs: 2_500, maximumDurationMs: 2_500 },
      { id: "shot-001-003", trimStartMs: 4_000, maximumDurationMs: 1_000 },
    ]);
    assert.ok(sampling.visualSamples.every((sample, index) => sample.label.includes(sampling.candidates[index]!.id)));
    const longFormStarts = videoShotCandidateStarts(661_361, maximumMarketingVisualCandidates);
    assert.equal(longFormStarts.length, 12);
    assert.equal(new Set(longFormStarts).size, longFormStarts.length);
    assert.ok(longFormStarts.every((start) => start >= 0 && start <= 660_361));
    assert.ok(longFormStarts.some((start) => start >= 540_000 && start <= 570_000));
    assert.throws(() => videoShotCandidateStarts(5_000, maximumMarketingVisualCandidates + 1), /候选镜头数量/);
    assert.throws(() => videoShotCandidateStarts(maximumMarketingSourceDurationSeconds * 1_000 + 1), /不能超过 900 秒/);
    console.log("PASS AI edit assistant receives bounded representative frames, not generated media");
  } finally { await rm(directory, { recursive: true, force: true }); }
})();
