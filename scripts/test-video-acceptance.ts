import assert from "node:assert/strict";

import { videoProjectSchema } from "../lib/video/contracts";
import { validateVideoExport } from "../lib/video/export-presets";
import { beginVideoJob, failVideoJob, createVideoJob } from "../lib/video/jobs";
import { selectVerifiedVideoModel } from "../lib/video/provider-capabilities";
import { assertTransition, type ApprovalDecision, type WorkflowEventInput } from "../lib/workflow/transitions";

const videoId = "00000000-0000-4000-8000-000000000201";
const project = {
  id: videoId,
  productId: "00000000-0000-4000-8000-000000000202",
  status: "export_ready" as const,
  objective: "Synthetic evidence-bound product introduction",
  targetAudience: "Synthetic distributor",
  platforms: ["youtube", "tiktok"] as const,
  factualClaims: [{ field: "product.product_name", value: "Synthetic clutch disc", evidenceRef: "evidence-product-201" }],
  sourceAssets: [
    { assetRef: "asset-product-201", mediaType: "image" as const, rightsEvidenceRef: "evidence-rights-201" },
    { assetRef: "asset-subtitle-201", mediaType: "subtitle" as const, rightsEvidenceRef: "evidence-rights-201" },
  ],
  scenes: [{ sceneId: "scene-201", prompt: "Use the approved synthetic product image with subtitles.", durationSeconds: 5, claimRefs: ["product.product_name"], assetRefs: ["asset-product-201", "asset-subtitle-201"] }],
  approvalRefs: ["approval-content-201", "approval-export-201"],
};

assert.equal(videoProjectSchema.parse(project).status, "export_ready");
assert.throws(() => videoProjectSchema.parse({ ...project, scenes: [{ ...project.scenes[0], assetRefs: ["asset-unlicensed-201"] }] }), /未授权素材/);
assert.throws(() => videoProjectSchema.parse({ ...project, factualClaims: [{ ...project.factualClaims[0], evidenceRef: "factory-document-201" }] }), /脱敏/);

const catalog = [{ provider: "google" as const, modelId: "synthetic-video-201", capabilities: ["text-to-video" as const], aspectRatios: ["9:16" as const], durationSeconds: { min: 1, max: 10 }, resolutions: ["1080x1920"], verifiedAt: new Date("2026-08-28T00:00:00Z"), verificationRef: "evidence-provider-201", enabled: true }];
assert.equal(selectVerifiedVideoModel(catalog, { provider: "google", modelId: "synthetic-video-201", requiredCapabilities: ["text-to-video"], aspectRatio: "9:16", durationSeconds: 5, resolution: "1080x1920" }).modelId, "synthetic-video-201");
assert.throws(() => selectVerifiedVideoModel([{ ...catalog[0], enabled: false }], { provider: "google", modelId: "synthetic-video-201", requiredCapabilities: ["text-to-video"], aspectRatio: "9:16", durationSeconds: 5, resolution: "1080x1920" }), /尚未通过验证/);

let job = createVideoJob("synthetic-job-201", "synthetic-key-201");
job = beginVideoJob(job, "synthetic-provider-job-201", 2);
job = failVideoJob(job, "synthetic timeout", true);
job = beginVideoJob(job, "synthetic-provider-job-202", 2);
job = failVideoJob(job, "synthetic timeout", true);
assert.throws(() => beginVideoJob(job, "synthetic-provider-job-203", 2), /quota/);

assert.equal(validateVideoExport({ platform: "youtube", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1920, height: 1080, fps: 30, durationSeconds: 5 }).platform, "youtube");
assert.equal(validateVideoExport({ platform: "tiktok", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 5 }).platform, "tiktok");
assert.equal(validateVideoExport({ platform: "facebook", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 5 }).surface, "reels");
assert.throws(() => validateVideoExport({ platform: "x", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1920, height: 1080, fps: 30, durationSeconds: 5 }), /不满足/);

const approval: ApprovalDecision = { id: "approval-content-201", aggregateId: videoId, gate: "gate_01_truth", status: "approved", decidedByType: "human", decidedById: "synthetic-reviewer", evidenceRef: "evidence-review-201" };
const reviewToApproved: WorkflowEventInput = { eventId: "event-video-201", entityType: "video", entityId: videoId, fromState: "VIDEO_REVIEW_REQUIRED", toState: "VIDEO_APPROVED", actorType: "human", actorId: "synthetic-reviewer", occurredAt: "2026-08-28T01:00:00Z", evidenceRefs: ["evidence-review-201"], gate: "gate_01_truth", approvalRef: approval.id };
assert.doesNotThrow(() => assertTransition(reviewToApproved, approval));
assert.throws(() => assertTransition({ ...reviewToApproved, actorType: "agent" }, approval), /cannot perform/);

console.log("PASS synthetic video acceptance: evidence, rights, provider, retry quota, export, subtitles, and human gate");
