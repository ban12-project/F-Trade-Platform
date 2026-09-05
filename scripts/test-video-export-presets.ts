import assert from "node:assert/strict";
import {
  VideoExportValidationError,
  validateVideoExport,
  videoExportPresets,
} from "../lib/video/export-presets";

assert.equal(
  validateVideoExport({
    platform: "tiktok",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 10,
  }).platform,
  "tiktok",
);
assert.equal(
  validateVideoExport({
    platform: "instagram",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 10,
  }).surface,
  "reels",
);
assert.throws(
  () =>
    validateVideoExport({
      platform: "facebook",
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 2,
    }),
  /不满足/,
);
console.log("PASS video export presets");

// Every channel accepts its exact preset, including inclusive duration limits.
for (const preset of videoExportPresets) {
  for (const durationSeconds of [preset.minDurationSeconds, preset.maxDurationSeconds]) {
    assert.equal(validateVideoExport({ ...preset, durationSeconds }), preset);
  }
  const input = {
    ...preset,
    container: "webm",
    videoCodec: "vp9",
    audioCodec: null,
    width: 123,
    height: 456,
    fps: 29.6,
    durationSeconds: preset.maxDurationSeconds + 1,
  };
  const before = structuredClone(input);
  assert.throws(
    () => validateVideoExport(input),
    (error: unknown) => {
      assert.ok(error instanceof VideoExportValidationError);
      assert.equal(error.platform, preset.platform);
      assert.equal(error.presetVersion, preset.version);
      assert.deepEqual(
        error.violations.map((item) => item.field),
        ["container", "videoCodec", "audioCodec", "width", "height", "fps", "durationSeconds"],
      );
      assert.equal(
        error.violations.find((item) => item.field === "audioCodec")?.remediation,
        "add_audio",
      );
      assert.equal(error.violations.find((item) => item.field === "fps")?.actual, 29.6);
      for (const item of error.violations) assert.ok(error.message.includes(item.field));
      return true;
    },
  );
  assert.deepEqual(input, before);
}
console.log("PASS all platform boundaries and field-specific export failures");
