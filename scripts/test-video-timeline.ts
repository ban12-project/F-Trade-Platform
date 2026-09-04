import assert from "node:assert/strict";

import type { VideoProject } from "../lib/video/contracts";
import { createMarketingTimeline } from "../lib/video/timeline";

const project: VideoProject = {
  id: "00000000-0000-4000-8000-000000000801",
  productId: "00000000-0000-4000-8000-000000000802",
  status: "approved",
  objective: "获取海外经销商询盘",
  targetAudience: "汽车配件经销商",
  platforms: ["tiktok"],
  factualClaims: [
    { field: "product.oe_number", value: "12345", evidenceRef: "evidence-product-801" },
  ],
  sourceAssets: [
    { assetRef: "asset-product-801", mediaType: "video", rightsEvidenceRef: "evidence-rights-801" },
  ],
  scenes: [
    {
      sceneId: "scene-001",
      prompt: "真实产品外观特写",
      durationSeconds: 4,
      claimRefs: ["product.oe_number"],
      assetRefs: ["asset-product-801"],
    },
    {
      sceneId: "scene-002",
      prompt: "包装与询盘 CTA",
      durationSeconds: 5,
      claimRefs: [],
      assetRefs: ["asset-product-801"],
    },
  ],
  approvalRefs: ["approval-video-801"],
};

const timeline = createMarketingTimeline(project, {
  sceneAssets: { "scene-001": "asset-generated-801", "scene-002": "asset-generated-802" },
  narration: {
    "scene-001": {
      text: "OE 12345 is available for verified applications.",
      claimRefs: ["product.oe_number"],
    },
  },
  soundtrackAssetRef: "asset-audio-801",
});

assert.equal(timeline.durationSeconds, 9);
assert.deepEqual(
  timeline.scenes.map((scene) => scene.startSeconds),
  [0, 4],
);
assert.equal(timeline.scenes[0]?.subtitles[0]?.endSeconds, 4);
assert.throws(
  () =>
    createMarketingTimeline(
      { ...project, status: "review_required" },
      { sceneAssets: { "scene-001": "asset-generated-801", "scene-002": "asset-generated-802" } },
    ),
  /人工审核/,
);
assert.throws(
  () =>
    createMarketingTimeline(project, {
      sceneAssets: { "scene-001": "asset-generated-801", "scene-002": "asset-generated-802" },
      narration: {
        "scene-001": { text: "Unverified diameter", claimRefs: ["specifications.clutch_diameter"] },
      },
    }),
  /未绑定证据/,
);
assert.throws(
  () => createMarketingTimeline(project, { sceneAssets: { "scene-001": "asset-generated-801" } }),
  /缺少/,
);

console.log(
  "PASS marketing timeline uses scene assets, explicit narration, and evidence-bound subtitles",
);
