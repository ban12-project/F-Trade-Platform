import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { extractMarketingVisualSamples } from "../lib/video/visual-sampling";

const execFileAsync = promisify(execFile);

void (async () => {
  const ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg";
  const ffprobeBin = process.env.FFPROBE_BIN ?? "ffprobe";
  const directory = await mkdtemp(join(tmpdir(), "f-trade-visual-sampling-test-"));
  try {
    const source = join(directory, "source.mp4");
    await execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    const samples = await extractMarketingVisualSamples(
      [{ assetRef: "evidence-video-sample", mediaType: "video", rightsEvidenceRef: "evidence-rights-sample" }],
      new Map([["evidence-video-sample", source]]),
      ffmpegBin,
      ffprobeBin,
    );
    assert.equal(samples.length, 3);
    assert.ok(samples.every((sample) => sample.mediaType === "image/jpeg" && sample.data.byteLength > 0));
    assert.match(samples[1]!.label, /evidence-video-sample/);
    console.log("PASS AI edit assistant receives bounded representative frames, not generated media");
  } finally { await rm(directory, { recursive: true, force: true }); }
})();
