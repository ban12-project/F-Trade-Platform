import assert from "node:assert/strict";
import { createReviewVideoExport } from "../lib/video/export-artifact";
import {
  createVideoExportManifest,
  videoExportManifestHeaders,
} from "../lib/video/export-manifest";
import { parseFfprobeOutput, validateProbedVideoExport } from "../lib/video/media-probe";

const measured = parseFfprobeOutput({
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: "5.0",
    size: "1250000",
    bit_rate: "2000000",
  },
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      bit_rate: "1800000",
      width: 1080,
      height: 1920,
      r_frame_rate: "30/1",
      pix_fmt: "yuv420p",
      sample_aspect_ratio: "1:1",
    },
    {
      codec_type: "audio",
      codec_name: "aac",
      bit_rate: "128000",
      sample_rate: "48000",
      channels: 2,
    },
    { codec_type: "subtitle", codec_name: "mov_text" },
  ],
});
assert.deepEqual(measured.resources, {
  fileSizeBytes: 1250000,
  containerBitrateBps: 2000000,
  videoBitrateBps: 1800000,
  audioBitrateBps: 128000,
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

const manifest = createVideoExportManifest(receipt);
assert.equal(manifest.validation.status, "passed");
assert.equal(manifest.validation.scope, "project_export_preset");
assert.equal(manifest.schemaVersion, "1.3.0");
assert.equal(manifest.encodingContractVersion, "1.0.0");
assert.equal(manifest.platformAcceptance.status, "not_evaluated");
assert.equal(manifest.reviewStatus, "review_required");
assert.deepEqual(manifest.measured, receipt.measured);
assert.equal("sourceAssetRef" in manifest, false);
assert.equal("approvalRef" in manifest, false);
assert.equal(
  createVideoExportManifest({ ...receipt, presetVersion: "historical-unknown" }).validation.status,
  "unverified",
);
assert.equal(
  createVideoExportManifest({ ...receipt, surface: "reels" }).validation.status,
  "unverified",
);
const failedManifest = createVideoExportManifest({
  ...receipt,
  measured: { ...receipt.measured, fps: 29.6 },
});
assert.equal(failedManifest.validation.status, "failed");
assert.equal(failedManifest.validation.violations[0]?.field, "fps");
const manifestHeaders = videoExportManifestHeaders("synthetic.manifest.json");
assert.equal(manifestHeaders["Cache-Control"], "private, no-store");
assert.equal(
  manifestHeaders["Content-Disposition"],
  'attachment; filename="synthetic.manifest.json"',
);
console.log(
  "PASS export manifests distinguish measured conformance from human approval and unknown presets",
);

assert.deepEqual(measured.encoding, {
  pixelFormat: "yuv420p",
  sampleAspectRatio: "1:1",
  audioSampleRate: 48000,
  audioChannels: 2,
});
for (const [field, actual] of [
  ["pixelFormat", "yuv444p"],
  ["sampleAspectRatio", "2:1"],
  ["audioSampleRate", 96000],
  ["audioChannels", 6],
] as const) {
  assert.throws(
    () =>
      validateProbedVideoExport("tiktok", {
        ...measured,
        encoding: { ...measured.encoding!, [field]: actual },
      }),
    new RegExp(field),
  );
}
assert.throws(
  () => validateProbedVideoExport("tiktok", { ...measured, encoding: undefined }),
  /pixelFormat.*missing/,
);
assert.equal(
  createVideoExportManifest({ ...receipt, measured: { ...receipt.measured, encoding: undefined } })
    .validation.status,
  "unverified",
);
assert.throws(
  () =>
    createReviewVideoExport({
      videoId: receipt.videoId,
      sourceAssetRef: receipt.sourceAssetRef,
      platform: receipt.platform,
      media: { ...measured, encoding: undefined },
      timeline: { durationSeconds: 5 },
    }),
  /pixelFormat.*missing/,
);
const missingEncoding = parseFfprobeOutput({
  format: { format_name: "mp4", duration: "5" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30/1" },
  ],
});
assert.deepEqual(missingEncoding.encoding, {
  pixelFormat: null,
  sampleAspectRatio: null,
  audioSampleRate: null,
  audioChannels: null,
});
console.log(
  "PASS measured encoding rejects unsupported or missing fields and preserves historical uncertainty",
);

assert.equal(manifest.resourceMeasurement.bitrateScope, "reported_average");
assert.equal(manifest.resourceMeasurement.peakBitrate, "not_measured");
assert.deepEqual(manifest.resourceMeasurement.unknownFields, []);
const historicalResources = createVideoExportManifest({
  ...receipt,
  measured: { ...receipt.measured, resources: undefined },
});
assert.deepEqual(historicalResources.measured.resources, {
  fileSizeBytes: null,
  containerBitrateBps: null,
  videoBitrateBps: null,
  audioBitrateBps: null,
});
assert.equal(historicalResources.resourceMeasurement.unknownFields.length, 4);
assert.equal(historicalResources.platformAcceptance.status, "not_evaluated");
for (const invalid of [
  undefined,
  "N/A",
  "",
  "0",
  "-1",
  "1.5",
  "1e6",
  " 12",
  "Infinity",
  "9007199254740992",
]) {
  const report = parseFfprobeOutput({
    format: { format_name: "mp4", duration: "5", size: invalid, bit_rate: invalid },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1080,
        height: 1920,
        r_frame_rate: "30/1",
        bit_rate: invalid,
      },
    ],
  });
  assert.deepEqual(report.resources, {
    fileSizeBytes: null,
    containerBitrateBps: null,
    videoBitrateBps: null,
    audioBitrateBps: null,
  });
}
assert.throws(() =>
  createVideoExportManifest({
    ...receipt,
    measured: {
      ...receipt.measured,
      resources: { ...measured.resources!, fileSizeBytes: Number.MAX_SAFE_INTEGER + 1 },
    },
  }),
);
console.log(
  "PASS reported size/bitrate units, invalid and historical unknowns; average never certifies peak or platform acceptance",
);
