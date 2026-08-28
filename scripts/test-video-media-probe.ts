import assert from "node:assert/strict";

import { parseFfprobeOutput, validateProbedVideoExport } from "../lib/video/media-probe";

const measured = parseFfprobeOutput({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5.0" }, streams: [
  { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30/1" },
  { codec_type: "audio", codec_name: "aac" },
  { codec_type: "subtitle", codec_name: "mov_text" },
] });
assert.equal(measured.subtitleStreamCount, 1);
assert.equal(validateProbedVideoExport("tiktok", measured).platform, "tiktok");
assert.equal(validateProbedVideoExport("instagram", measured).surface, "reels");
assert.equal(validateProbedVideoExport("facebook", measured).surface, "reels");
assert.throws(() => parseFfprobeOutput({ format: { format_name: "matroska", duration: "5" }, streams: [] }), /MP4/);
assert.throws(() => validateProbedVideoExport("facebook", { ...measured, durationSeconds: 2 }), /不满足/);
console.log("PASS video export validation consumes measured ffprobe metadata");
