import assert from "node:assert/strict";

import { parseProductMediaProbeOutput } from "../lib/product/media-probe-parser";

const image = parseProductMediaProbeOutput(
  {
    streams: [{ codec_type: "video", width: 1600, height: 1200, avg_frame_rate: "25/1" }],
    format: { duration: "0.040" },
  },
  "image/jpeg",
);
assert.deepEqual(image, {
  mediaType: "image",
  technical: {
    contentType: "image/jpeg",
    width: 1600,
    height: 1200,
    durationMs: null,
    fps: null,
    hasAudio: false,
  },
});

const video = parseProductMediaProbeOutput(
  {
    streams: [
      {
        codec_type: "video",
        width: 1080,
        height: 1920,
        avg_frame_rate: "30000/1001",
        r_frame_rate: "30/1",
      },
      { codec_type: "audio" },
    ],
    format: { duration: "12.3456" },
  },
  "video/mp4",
);
assert.equal(video.mediaType, "video");
assert.equal(video.technical.durationMs, 12_346);
assert.ok(video.technical.fps !== null && Math.abs(video.technical.fps - 29.97002997) < 0.0001);
assert.equal(video.technical.hasAudio, true);

const fallbackRate = parseProductMediaProbeOutput(
  {
    streams: [
      {
        codec_type: "video",
        width: 1920,
        height: 1080,
        avg_frame_rate: "0/0",
        r_frame_rate: "24/1",
      },
    ],
    format: { duration: "1.5" },
  },
  "video/quicktime",
);
assert.equal(fallbackRate.technical.fps, 24);
assert.equal(fallbackRate.technical.hasAudio, false);

assert.throws(
  () => parseProductMediaProbeOutput({ streams: [], format: { duration: "1" } }, "video/mp4"),
  /画面尺寸/,
);
assert.throws(
  () =>
    parseProductMediaProbeOutput(
      { streams: [{ codec_type: "video", width: 100, height: 100 }], format: { duration: "121" } },
      "video/mp4",
    ),
  /120 秒/,
);
assert.throws(
  () =>
    parseProductMediaProbeOutput(
      { streams: [{ codec_type: "video", width: 100, height: 100 }], format: { duration: "1" } },
      "video/mp4",
    ),
  /帧率/,
);
assert.throws(
  () =>
    parseProductMediaProbeOutput(
      { streams: [{ codec_type: "video", width: 100, height: 100 }] },
      "application/octet-stream",
    ),
  /受控图片或视频/,
);

console.log("PASS ProductMedia ffprobe output is converted into bounded trusted metadata");
