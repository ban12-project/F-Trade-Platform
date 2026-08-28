import assert from "node:assert/strict";
import { validateVideoExport } from "../lib/video/export-presets";
assert.equal(validateVideoExport({ platform: "tiktok", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 10 }).platform, "tiktok");
assert.equal(validateVideoExport({ platform: "instagram", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 10 }).surface, "reels");
assert.throws(() => validateVideoExport({ platform: "facebook", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 2 }), /不满足/);
console.log("PASS video export presets");
