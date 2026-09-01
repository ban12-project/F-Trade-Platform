import assert from "node:assert/strict";

import type { VideoProject } from "../lib/video/contracts";
import { marketingVideoDraftSchema } from "../lib/video/edit-contracts";
import { renderApprovedMarketingTimeline } from "../lib/video/rendering";
import { createMarketingEditTimeline } from "../lib/video/timeline";

const baseClip = { clipId: "clip-001", assetRef: "evidence-source-001", mediaType: "video" as const, trimStartMs: 0, durationMs: 10_000, fitMode: "cover" as const, audioMode: "muted" as const, subtitle: "Verified OE 12345", claimRefs: ["product.oe_number"] };
const exact = marketingVideoDraftSchema.parse({ version: 1, platform: "facebook", clips: [baseClip, { ...baseClip, clipId: "clip-002", durationMs: 5_000 }], ctaText: "Contact us" });
assert.equal(exact.clips.reduce((sum, clip) => sum + clip.durationMs, 0), 15_000);
assert.throws(() => marketingVideoDraftSchema.parse({ ...exact, clips: [baseClip, { ...baseClip, clipId: "clip-002", durationMs: 5_001 }] }), /15 秒/);
assert.throws(() => marketingVideoDraftSchema.parse({ ...exact, clips: [{ ...baseClip, durationMs: 10_001 }] }), /10 秒/);
assert.throws(() => marketingVideoDraftSchema.parse({ ...exact, clips: [{ ...baseClip, mediaType: "image", trimStartMs: 1 }] }), /图片素材/);

const project: VideoProject = {
  id: "00000000-0000-4000-8000-000000000501", productId: "00000000-0000-4000-8000-000000000502", status: "draft",
  objective: "Inquiry", targetAudience: "Distributor", platforms: ["facebook"],
  factualClaims: [{ field: "product.oe_number", value: "12345", evidenceRef: "evidence-product-501" }],
  sourceAssets: [{ assetRef: "evidence-source-001", mediaType: "video", rightsEvidenceRef: "evidence-rights-501" }],
  scenes: [{ sceneId: "scene-001", prompt: "Authorized source", durationSeconds: 10, claimRefs: [], assetRefs: ["evidence-source-001"] }], approvalRefs: [], editDraft: marketingVideoDraftSchema.parse({ version: 1, platform: "facebook", clips: [baseClip], ctaText: "Contact us" }),
};
void (async () => {
  const timeline = createMarketingEditTimeline(project, project.editDraft!);
  assert.equal(timeline.durationSeconds, 10);
  assert.equal(timeline.scenes[0]?.trimStartSeconds, 0);
  assert.equal(timeline.cta?.startSeconds, 8);
  assert.throws(() => createMarketingEditTimeline(project, { ...project.editDraft!, clips: [{ ...baseClip, claimRefs: ["specifications.diameter"] }] }), /未绑定证据/);
  await assert.rejects(() => renderApprovedMarketingTimeline({ timeline: { ...timeline, durationSeconds: 16, scenes: [{ ...timeline.scenes[0]!, durationSeconds: 16 }] }, platform: "facebook", width: 1080, height: 1920, fps: 30 }, { async render() { return { assetRef: "asset-invalid" }; } }), /15 秒/);
  console.log("PASS MVP1 marketing edit contract enforces grounded clips and a 15-second total");
})();
