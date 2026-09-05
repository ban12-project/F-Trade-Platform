import assert from "node:assert/strict";
import { createReviewVideoExport } from "../lib/video/export-artifact";
import { parseFfprobeOutput, validateProbedVideoExport } from "../lib/video/media-probe";

const measured = parseFfprobeOutput({
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5.0" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac" },
    { codec_type: "subtitle", codec_name: "mov_text" },
  ],
});
assert.equal(measured.subtitleStreamCount, 1);
assert.equal(validateProbedVideoExport("tiktok", measured).platform, "tiktok");
assert.equal(validateProbedVideoExport("instagram", measured).surface, "reels");
assert.equal(validateProbedVideoExport("facebook", measured).surface, "reels");
const receipt = createReviewVideoExport({
  videoId: "00000000-0000-4000-8000-000000000601",
  sourceAssetRef: "asset-video-601",
  platform: "tiktok",
  media: measured,
  timeline: { durationSeconds: 5 },
});
assert.equal(receipt.status, "review_required");
assert.equal(receipt.presetVersion, "2026-08");
assert.equal(receipt.timelineDurationSeconds, 5);
assert.equal(receipt.measured.videoCodec, "h264");
assert.equal(receipt.measured.audioCodec, "aac");
assert.equal("publicUrl" in receipt, false);
assert.throws(
  () =>
    createReviewVideoExport({
      videoId: "00000000-0000-4000-8000-000000000601",
      sourceAssetRef: "asset-video-601",
      platform: "tiktok",
      media: measured,
      timeline: { durationSeconds: 4 },
    }),
  /时间线/,
);
assert.throws(
  () => parseFfprobeOutput({ format: { format_name: "matroska", duration: "5" }, streams: [] }),
  /MP4/,
);
assert.throws(
  () => validateProbedVideoExport("facebook", { ...measured, durationSeconds: 2 }),
  /不满足/,
);
assert.throws(
  () =>
    createReviewVideoExport({
      videoId: "00000000-0000-4000-8000-000000000601",
      sourceAssetRef: "asset-video-601",
      platform: "tiktok",
      media: { ...measured, videoCodec: "vp9" },
      timeline: { durationSeconds: 5 },
    }),
  /h264|invalid/i,
);
console.log("PASS video export validation consumes measured ffprobe metadata");

for (const fps of [29.6, 30000 / 1001, 30.4]) {
  assert.throws(() => validateProbedVideoExport("tiktok", { ...measured, fps }), /fps/);
}
assert.throws(
  () => validateProbedVideoExport("tiktok", { ...measured, audioCodec: null }),
  /audioCodec.*missing/,
);
for (const rate of ["30/0", "0/0", "30/1/2", "30/", "NaN", "-30/1"]) {
  assert.throws(
    () =>
      parseFfprobeOutput({
        format: { format_name: "mp4", duration: "5" },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1080,
            height: 1920,
            r_frame_rate: rate,
          },
        ],
      }),
    /invalid video frame rate/,
  );
}
console.log("PASS measured frame rates are neither rounded nor malformed");
