import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createReviewVideoExport } from "../lib/video/export-artifact";
import { createVideoExportManifest } from "../lib/video/export-manifest";
import { VideoExportValidationError, videoExportPresets } from "../lib/video/export-presets";
import { createFfmpegTimelineRenderer } from "../lib/video/ffmpeg-renderer";
import { inspectVideoFile, validateProbedVideoExport } from "../lib/video/media-probe";
import { renderApprovedMarketingTimeline } from "../lib/video/rendering";
import type { MarketingTimeline } from "../lib/video/timeline";

const execFileAsync = promisify(execFile);

void (async () => {
  const workspace = await mkdtemp(join(tmpdir(), "f-trade-ffmpeg-test-"));
  try {
    const ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg";
    const ffprobeBin = process.env.FFPROBE_BIN ?? "ffprobe";
    const source = join(workspace, "synthetic-master.mp4");
    await execFileAsync(ffmpegBin, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:r=25:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      source,
    ]);
    const hash = async () =>
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
    const sourceHash = await hash();
    const master = await inspectVideoFile(source, ffprobeBin);
    assert.throws(
      () => validateProbedVideoExport("youtube", master),
      (error: unknown) => {
        assert.ok(error instanceof VideoExportValidationError);
        assert.deepEqual(
          error.violations.map((item) => item.field),
          ["width", "height", "fps"],
        );
        return true;
      },
    );
    assert.equal(await hash(), sourceHash, "validation must not alter a rejected master");
    const timeline: MarketingTimeline = {
      durationSeconds: 3,
      scenes: [
        {
          sceneId: "scene-synthetic-001",
          assetRef: "asset-synthetic-master-001",
          mediaType: "video",
          trimStartSeconds: 0.5,
          fitMode: "cover",
          audioMode: "source",
          startSeconds: 0,
          durationSeconds: 1.5,
          prompt: "Synthetic black test frame",
          claimRefs: [],
          subtitles: [{ text: "SYNTHETIC TEST", startSeconds: 0, endSeconds: 1.2, claimRefs: [] }],
        },
        {
          sceneId: "scene-synthetic-002",
          assetRef: "asset-synthetic-master-001",
          mediaType: "video",
          trimStartSeconds: 2,
          fitMode: "contain",
          audioMode: "muted",
          startSeconds: 1.5,
          durationSeconds: 1.5,
          prompt: "Synthetic black test frame",
          claimRefs: [],
          subtitles: [],
        },
      ],
      cta: { text: "SYNTHETIC CTA", startSeconds: 2, endSeconds: 3 },
    };
    const originalTimeline = structuredClone(timeline);
    for (const preset of videoExportPresets) {
      let stored = false;
      const renderer = createFfmpegTimelineRenderer({
        ffmpegBin,
        ffprobeBin,
        resolvePrivateAssetPath: async (ref) => {
          assert.equal(ref, "asset-synthetic-master-001");
          return source;
        },
        storeRenderedVideo: async ({ filePath }) => {
          assert.ok((await stat(filePath)).size > 0);
          const measured = await inspectVideoFile(filePath, ffprobeBin);
          assert.equal(validateProbedVideoExport(preset.platform, measured), preset);
          assert.ok(
            Math.abs(measured.durationSeconds - 3) <= 0.1,
            `Expected 3s, measured ${measured.durationSeconds}s`,
          );
          // The source is entirely black: bright pixels prove both timed text overlays survived encoding.
          for (const seconds of [0.5, 2.5]) {
            const { stdout } = await execFileAsync(
              ffmpegBin,
              [
                "-v",
                "error",
                "-ss",
                String(seconds),
                "-i",
                filePath,
                "-frames:v",
                "1",
                "-pix_fmt",
                "gray",
                "-f",
                "rawvideo",
                "pipe:1",
              ],
              { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 },
            );
            assert.ok(
              stdout.filter((pixel) => pixel > 200).length > 10,
              `${preset.platform}: text missing at ${seconds}s`,
            );
          }
          // Verify source sound survives the first clip and the second clip is actually muted.
          const rms: number[] = [];
          for (const seconds of [0.5, 2.5]) {
            const { stdout } = await execFileAsync(
              ffmpegBin,
              [
                "-v",
                "error",
                "-ss",
                String(seconds),
                "-i",
                filePath,
                "-t",
                "0.2",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "8000",
                "-f",
                "s16le",
                "pipe:1",
              ],
              { encoding: "buffer" },
            );
            assert.ok(stdout.length > 0);
            let energy = 0;
            for (let index = 0; index + 1 < stdout.length; index += 2)
              energy += stdout.readInt16LE(index) ** 2;
            rms.push(Math.sqrt(energy / (stdout.length / 2)));
          }
          assert.ok(rms[0]! > 100, `${preset.platform}: source audio missing`);
          assert.ok(rms[1]! < 10, `${preset.platform}: muted clip contains sound`);
          const artifact = createReviewVideoExport({
            videoId: "00000000-0000-4000-8000-000000000602",
            sourceAssetRef: `asset-synthetic-${preset.platform}-001`,
            platform: preset.platform,
            media: measured,
            timeline: { durationSeconds: timeline.durationSeconds },
          });
          const manifest = createVideoExportManifest(artifact);
          assert.equal(manifest.validation.status, "passed");
          assert.equal(manifest.reviewStatus, "review_required");
          stored = true;
          console.log(
            `PASS ${preset.platform}: ${measured.width}x${measured.height} ${measured.fps} FPS; captions, CTA, source/muted audio and manifest`,
          );
          return artifact.sourceAssetRef;
        },
      });
      const result = await renderApprovedMarketingTimeline(
        {
          platform: preset.platform,
          width: preset.width,
          height: preset.height,
          fps: preset.fps,
          timeline,
        },
        renderer,
      );
      assert.equal(result.assetRef, `asset-synthetic-${preset.platform}-001`);
      assert.equal(stored, true);
      assert.deepEqual(timeline, originalTimeline);
    }
    assert.equal(await hash(), sourceHash);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
})();
