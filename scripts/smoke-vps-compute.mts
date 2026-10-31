/** Explicit live smoke. Requires a signed URL to a synthetic >=3s MP4 source;
 * never point this at account/customer data. No publication or DB writes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { preprocessProductAgentDocument } from "../lib/product/document-source";
import { probeProductMediaEvidenceInSandbox } from "../lib/product/media-sandbox-probe";
import { renderMarketingTimelineWithRemotion } from "../lib/video/remotion-sandbox";
import type { VideoRenderRequest } from "../lib/video/rendering";
import {
  extractMarketingVisualSamplesInSandbox,
  renderMarketingTimelineInSandbox,
} from "../lib/video/sandbox-media";

assert.equal(process.env.COMPUTE_PROVIDER, "vps", "Smoke must explicitly select VPS");
const sourceUrl = process.env.VPS_SMOKE_SOURCE_URL;
assert.ok(sourceUrl, "Set VPS_SMOKE_SOURCE_URL to a synthetic MP4 signed URL");
const output = resolve("tmp", `vps-compute-smoke-${randomUUID()}`);
await mkdir(output, { recursive: true });
const documentPath = resolve(output, "synthetic.txt");
await writeFile(documentPath, "SYNTHETIC TEST DOCUMENT. No product facts or customer data.\n");
console.log("smoke stage: document");
const document = await preprocessProductAgentDocument({
  documentPath,
  recordId: "vps-synthetic",
  imageAvailability: "none",
  imageRefs: [],
});
assert.match(document.source.source_text, /SYNTHETIC TEST DOCUMENT/);
const assetRef = "evidence-vps-synthetic";
const sources = new Map([
  [
    assetRef,
    {
      assetRef,
      signedGetUrl: sourceUrl,
      hostname: new URL(sourceUrl).hostname,
      extension: ".mp4",
      contentType: "video/mp4",
    },
  ],
]);
console.log("smoke stage: media-probe");
const media = await probeProductMediaEvidenceInSandbox(assetRef, sources);
console.log("smoke stage: visual-sampling");
const sampled = await extractMarketingVisualSamplesInSandbox(
  [{ assetRef, mediaType: "video", rightsEvidenceRef: "evidence-vps-synthetic-rights" }],
  sources,
);
assert.ok(sampled.candidates.length && sampled.visualSamples.length);
assert.ok(sampled.visualSamples.every((sample) => sample.data.length > 100));
const request: VideoRenderRequest = {
  platform: "facebook",
  width: 1080,
  height: 1920,
  fps: 30,
  timeline: {
    durationSeconds: 3,
    scenes: [
      {
        sceneId: "synthetic-scene",
        assetRef,
        mediaType: "video",
        trimStartSeconds: 0,
        fitMode: "contain",
        audioMode: "muted",
        abcdRoles: ["attention", "branding", "connection", "direction"],
        motionPreset: "cta_hold",
        startSeconds: 0,
        durationSeconds: 3,
        prompt: "Synthetic fixture",
        claimRefs: [],
        subtitles: [{ text: "SYNTHETIC TEST", startSeconds: 0, endSeconds: 3, claimRefs: [] }],
      },
    ],
    cta: { text: "Synthetic fixture only", startSeconds: 0, endSeconds: 3 },
  },
};
console.log("smoke stage: ffmpeg-render");
const ffmpeg = await renderMarketingTimelineInSandbox(request, sources);
assert.equal(ffmpeg.probe.videoCodec, "h264");
assert.equal(ffmpeg.probe.audioCodec, "aac");
assert.equal(ffmpeg.probe.width, 1080);
await writeFile(resolve(output, "ffmpeg.mp4"), ffmpeg.data);
console.log("smoke stage: remotion-render");
const remotion = await renderMarketingTimelineWithRemotion(
  request,
  sources,
  "SYNTHETIC TEST PRODUCT",
);
assert.equal(remotion.probe.videoCodec, "h264");
assert.equal(remotion.probe.audioCodec, "aac");
assert.equal(remotion.probe.width, 1080);
assert.equal(remotion.probe.height, 1920);
assert.ok(Math.abs(remotion.probe.durationSeconds - 3) < 0.1);
await writeFile(resolve(output, "remotion.mp4"), remotion.data);
const result = {
  document: { sha256: document.document_sha256, status: document.conversion_status },
  media,
  sampleCount: sampled.visualSamples.length,
  ffmpeg: ffmpeg.probe,
  remotion: remotion.probe,
};
await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: "passed", output, ...result }, null, 2));
