import assert from "node:assert/strict";

import {
  selectVerifiedVideoModel,
  type VideoModelCapability,
  videoModelCapabilitySchema,
} from "../lib/video/provider-capabilities";

const model: VideoModelCapability = {
  provider: "fal",
  modelId: "synthetic-video-model",
  capabilities: ["text-to-video", "image-to-video"],
  aspectRatios: ["16:9", "9:16"],
  durationSeconds: { min: 5, max: 10 },
  resolutions: ["1280x720", "720x1280"],
  verifiedAt: new Date("2026-08-28T00:00:00Z"),
  verificationRef: "evidence-video-provider-001",
  enabled: true,
};

assert.equal(
  selectVerifiedVideoModel([model], {
    provider: "fal",
    modelId: model.modelId,
    requiredCapabilities: ["text-to-video"],
    aspectRatio: "9:16",
    durationSeconds: 5,
    resolution: "720x1280",
  }).modelId,
  model.modelId,
);
assert.throws(
  () =>
    selectVerifiedVideoModel([{ ...model, enabled: false }], {
      provider: "fal",
      modelId: model.modelId,
      requiredCapabilities: ["text-to-video"],
      aspectRatio: "9:16",
      durationSeconds: 5,
      resolution: "720x1280",
    }),
  /尚未通过验证/,
);
assert.throws(
  () =>
    selectVerifiedVideoModel([model], {
      provider: "fal",
      modelId: model.modelId,
      requiredCapabilities: ["audio-generation"],
      aspectRatio: "9:16",
      durationSeconds: 5,
      resolution: "720x1280",
    }),
  /不满足/,
);
assert.throws(
  () => videoModelCapabilitySchema.parse({ ...model, verificationRef: null }),
  /验证时间/,
);

console.log("PASS video provider capability registry");
