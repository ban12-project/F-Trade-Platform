import assert from "node:assert/strict";

import { marketingVideoDraftSchema } from "../lib/video/edit-contracts";
import { createRemotionCompositionProps } from "../lib/video/remotion-props";
import { createMarketingEditTimeline } from "../lib/video/timeline";
import type { VideoProject } from "../lib/video/contracts";
import { compositionDurationInFrames, resolveAbcdBeatState } from "../remotion/abcd-types";

const migrated = marketingVideoDraftSchema.parse({
  version: 2,
  platform: "facebook",
  clips: [{ clipId: "clip-001", assetRef: "evidence-source-001", mediaType: "video", trimStartMs: 2_000, durationMs: 8_000, fitMode: "cover", audioMode: "muted", caption: { kind: "verified_fact", claimRef: "product.product_name" } }],
  ctaText: "Request product details",
});
assert.equal(migrated.version, 3);
assert.equal(migrated.creativeFramework, "google_abcd");
assert.deepEqual(migrated.clips[0]?.abcdRoles, ["attention", "branding", "connection", "direction"]);

const incomplete = { ...migrated, clips: [{ ...migrated.clips[0]!, abcdRoles: ["attention", "branding", "direction"] as const }] };
assert.equal(marketingVideoDraftSchema.safeParse(incomplete).success, false);
assert.equal(marketingVideoDraftSchema.safeParse({ ...migrated, clips: [{ ...migrated.clips[0]!, abcdRoles: ["branding", "connection", "direction"] }] }).success, false);
assert.equal(marketingVideoDraftSchema.safeParse({ ...migrated, clips: [{ ...migrated.clips[0]!, abcdRoles: ["attention", "connection", "direction"] }] }).success, false);

const project: VideoProject = {
  id: "00000000-0000-4000-8000-000000000601",
  productId: "00000000-0000-4000-8000-000000000602",
  status: "draft",
  objective: "Create a distributor inquiry",
  targetAudience: "Distributors",
  platforms: ["facebook"],
  factualClaims: [{ field: "product.product_name", value: "RYC302 Clutch Kit", evidenceRef: "evidence-product-601" }],
  sourceAssets: [{ assetRef: "evidence-source-001", mediaType: "video", rightsEvidenceRef: "evidence-rights-601" }],
  scenes: [{ sceneId: "scene-001", prompt: "Authorized source", durationSeconds: 8, claimRefs: [], assetRefs: ["evidence-source-001"] }],
  approvalRefs: [],
  editDraft: migrated,
};
const timeline = createMarketingEditTimeline(project, migrated);
const props = createRemotionCompositionProps(
  { timeline, platform: "facebook", width: 1080, height: 1920, fps: 30 },
  new Map([["evidence-source-001", { assetRef: "evidence-source-001", contentType: "video/mp4", extension: ".mp4", hostname: "private.example", signedGetUrl: "https://private.example/source.mp4?token=short-lived" }]]),
  "RYC302 Clutch Kit",
);
assert.equal(props.clips[0]?.trimStartFrame, 60);
assert.equal(props.clips[0]?.caption, "RYC302 Clutch Kit");
assert.equal(compositionDurationInFrames(props), 240);
assert.deepEqual(resolveAbcdBeatState(props.clips[0]!, 0), { attention: true, branding: true, connection: false, direction: false, phaseStartFrame: 0 });
assert.deepEqual(resolveAbcdBeatState(props.clips[0]!, 100), { attention: false, branding: true, connection: true, direction: false, phaseStartFrame: 80 });
assert.deepEqual(resolveAbcdBeatState(props.clips[0]!, 200), { attention: false, branding: true, connection: false, direction: true, phaseStartFrame: 160 });
assert.equal(JSON.stringify(project).includes("private.example"), false);
assert.throws(() => createRemotionCompositionProps(
  { timeline, platform: "x", width: 1280, height: 720, fps: 30 },
  new Map(),
  "RYC302 Clutch Kit",
), /竖屏/);

console.log("PASS Remotion ABCD v3 preserves governed facts, private source boundaries, and deterministic duration");
