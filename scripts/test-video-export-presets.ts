import assert from "node:assert/strict";
import { validateVideoExport } from "../lib/video/export-presets";
assert.equal(validateVideoExport({ platform: "tiktok", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 10 }).platform, "tiktok");
assert.throws(() => validateVideoExport({ platform: "instagram", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 10 }), /尚未/);
console.log("PASS video export presets");
