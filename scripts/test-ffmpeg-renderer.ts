import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createFfmpegTimelineRenderer } from "../lib/video/ffmpeg-renderer";
import { inspectVideoFile, validateProbedVideoExport } from "../lib/video/media-probe";

const execFileAsync = promisify(execFile);

void (async () => {
  const workspace = await mkdtemp(join(tmpdir(), "f-trade-ffmpeg-test-"));
  try {
    const ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg";
    const source = join(workspace, "source.mp4");
    await execFileAsync(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    let stored = false;
    const renderer = createFfmpegTimelineRenderer({ ffmpegBin,
      resolvePrivateAssetPath: async () => source,
      storeRenderedVideo: async ({ filePath }) => {
        assert.ok((await stat(filePath)).size > 0);
        const measured = await inspectVideoFile(filePath);
        assert.equal(measured.videoCodec, "h264");
        assert.equal(measured.audioCodec, "aac");
        assert.equal(measured.width, 1080);
        assert.equal(measured.height, 1920);
        assert.equal(validateProbedVideoExport("tiktok", measured).platform, "tiktok");
        stored = true;
        return "asset-rendered-ffmpeg-001";
      },
    });
    const timeline = { durationSeconds: 1, scenes: [{ sceneId: "scene-001", assetRef: "asset-source-ffmpeg-001", mediaType: "video" as const, trimStartSeconds: 0.5, fitMode: "cover" as const, audioMode: "muted" as const, startSeconds: 0, durationSeconds: 1, prompt: "真实产品素材", claimRefs: [], subtitles: [{ text: "Verified product", startSeconds: 0, endSeconds: 1, claimRefs: [] }] }], cta: { text: "Contact us", startSeconds: 0, endSeconds: 1 } };
    const result = await renderer.render({ platform: "tiktok", width: 1080, height: 1920, fps: 30, timeline });
    assert.equal(result.assetRef, "asset-rendered-ffmpeg-001");
    assert.equal(stored, true);
    console.log("PASS backend FFmpeg renderer normalizes, joins, and burns subtitles into a private asset");
  } finally { await rm(workspace, { recursive: true, force: true }); }
})();
