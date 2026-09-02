import assert from "node:assert/strict";

import { parseProductMediaFfprobeReport } from "../lib/product/media-probe";

const image = parseProductMediaFfprobeReport("image/jpeg", {
  format: { format_name: "jpeg_pipe" },
  streams: [{ codec_type: "video", codec_name: "mjpeg", width: 1600, height: 1200, avg_frame_rate: "0/0", r_frame_rate: "25/1" }],
});
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

const video = parseProductMediaFfprobeReport("video/mp4", {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.3456" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", r_frame_rate: "30/1", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "aac" },
  ],
});
assert.equal(video.mediaType, "video");
assert.equal(video.technical.durationMs, 12_346);
assert.equal(video.technical.fps, 29.97003);
assert.equal(video.technical.hasAudio, true);

const quickTimeWithoutAudio = parseProductMediaFfprobeReport("video/quicktime", {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  streams: [
    { codec_type: "video", codec_name: "hevc", width: 1080, height: 1920, duration: "5", avg_frame_rate: "0/0", r_frame_rate: "25/1" },
    { codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } },
  ],
});
assert.equal(quickTimeWithoutAudio.technical.durationMs, 5_000);
assert.equal(quickTimeWithoutAudio.technical.fps, 25);
assert.equal(quickTimeWithoutAudio.technical.hasAudio, false);

assert.throws(() => parseProductMediaFfprobeReport("application/octet-stream", {
  format: { format_name: "data" },
  streams: [{ codec_type: "video", codec_name: "h264", width: 100, height: 100 }],
}), /Invalid option|Invalid input|invalid/i);

assert.throws(() => parseProductMediaFfprobeReport("image/jpeg", {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  streams: [{ codec_type: "video", codec_name: "h264", width: 100, height: 100 }],
}), /Content-Type 与实际媒体格式不一致/);

assert.throws(() => parseProductMediaFfprobeReport("video/mp4", {
  format: { format_name: "matroska,webm", duration: "5" },
  streams: [{ codec_type: "video", codec_name: "vp9", width: 100, height: 100, avg_frame_rate: "25/1" }],
}), /Content-Type 与实际媒体容器不一致/);

assert.throws(() => parseProductMediaFfprobeReport("image/png", {
  format: { format_name: "png_pipe" },
  streams: [{ codec_type: "video", codec_name: "png", width: 100, height: 100 }, { codec_type: "audio", codec_name: "aac" }],
}), /图片素材不能包含音轨/);

assert.throws(() => parseProductMediaFfprobeReport("video/mp4", {
  format: { format_name: "mov,mp4", duration: "5" },
  streams: [{ codec_type: "video", codec_name: "h264", width: 100, height: 100, avg_frame_rate: "0/0", r_frame_rate: "0/0" }],
}), /有效帧率/);

assert.throws(() => parseProductMediaFfprobeReport("video/mp4", {
  format: { format_name: "mov,mp4", duration: "0" },
  streams: [{ codec_type: "video", codec_name: "h264", width: 100, height: 100, avg_frame_rate: "25/1" }],
}), /有效时长/);

assert.throws(() => parseProductMediaFfprobeReport("video/mp4", {
  format: { format_name: "mov,mp4", duration: "5" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 100, height: 100, avg_frame_rate: "25/1" },
    { codec_type: "video", codec_name: "hevc", width: 200, height: 200, avg_frame_rate: "25/1" },
  ],
}), /多个主画面轨道/);

assert.throws(() => parseProductMediaFfprobeReport("video/mp4", {
  format: { format_name: "mov,mp4", duration: "5" },
  streams: [{ codec_type: "audio", codec_name: "aac" }],
}), /缺少可用的主画面轨道/);

assert.throws(() => parseProductMediaFfprobeReport("video/mp4", {
  format: { format_name: "mov,mp4", duration: "121" },
  streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "25/1" }],
}), /Too big|小于等于|less than or equal|120000/i);

assert.throws(() => parseProductMediaFfprobeReport("image/webp", {
  format: { format_name: "webp_pipe" },
  streams: [{ codec_type: "video", codec_name: "webp", width: 40_000, height: 100 }],
}), /Too big|小于等于|less than or equal|32768/i);

console.log("PASS ProductMedia probes derive bounded technical facts and verify media identity");
