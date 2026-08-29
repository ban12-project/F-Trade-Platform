import assert from "node:assert/strict";

import { videoProjectSchema } from "../lib/video/contracts";
import { assertTransition, type WorkflowEventInput } from "../lib/workflow/transitions";

const project = {
  id: "019a4c5c-1685-7f24-935b-2c27f7bbcc95",
  productId: "019a4c5c-1685-7f24-935b-2c27f7bbcc96",
  status: "export_ready",
  objective: "Explain a verified clutch-disc product fact.",
  targetAudience: "Independent aftermarket distributors",
  platforms: ["youtube", "tiktok"],
  factualClaims: [{ field: "product.name", value: "Synthetic clutch disc", evidenceRef: "evidence-product-001" }],
  sourceAssets: [{ assetRef: "asset-product-001", mediaType: "image", rightsEvidenceRef: "evidence-rights-001" }],
  scenes: [{ sceneId: "scene-001", prompt: "Show the approved product image.", durationSeconds: 5, claimRefs: ["product.name"], assetRefs: ["asset-product-001"] }],
  approvalRefs: ["approval-content-001", "approval-export-001"],
};

assert.equal(videoProjectSchema.parse(project).status, "export_ready");
assert.equal(videoProjectSchema.parse({ ...project, approvalRefs: [] }).status, "export_ready");
assert.throws(() => videoProjectSchema.parse({ ...project, scenes: [{ ...project.scenes[0], claimRefs: ["product.oe_number"] }] }), /未绑定证据/);

const event: WorkflowEventInput = { eventId: "event-01", entityType: "video", entityId: project.id, fromState: "VIDEO_DRAFT", toState: "VIDEO_READY_FOR_GENERATION", actorType: "human", actorId: "creator-01", occurredAt: "2026-08-28T13:10:00Z", evidenceRefs: ["evidence-review-01"] };
assertTransition(event);
assertTransition({ ...event, actorType: "agent" });

console.log("PASS video contracts and advisory creative transitions");
