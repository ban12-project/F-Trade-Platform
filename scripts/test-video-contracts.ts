import assert from "node:assert/strict";

import { saveVideoCanvasSchema, videoCanvasDocumentSchema } from "../lib/video/canvas-contracts";
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

const canvas = {
  version: 1,
  nodes: [
    { id: "brief", type: "input", position: { x: 0, y: 0 }, deletable: false, data: { label: "Brief" } },
    { id: "facts", position: { x: 200, y: 0 }, data: { label: "Facts" } },
    { id: "assets", position: { x: 200, y: 120 }, data: { label: "Assets" } },
    { id: "generate", type: "output", position: { x: 400, y: 0 }, deletable: false, data: { label: "Generate" } },
  ],
  edges: [
    { id: "brief-facts", source: "brief", target: "facts" },
    { id: "facts-generate", source: "facts", target: "generate" },
    { id: "assets-generate", source: "assets", target: "generate" },
  ],
};
assert.equal(videoCanvasDocumentSchema.parse(canvas).nodes.length, 4);
assert.equal(saveVideoCanvasSchema.parse({ expectedRevision: 0, document: canvas }).expectedRevision, 0);
assert.equal(videoCanvasDocumentSchema.parse({ ...canvas, factBinding: { productId: "019a4c5c-1685-7f24-935b-2c27f7bbcc96", factPath: "product.product_name" } }).factBinding?.factPath, "product.product_name");
assert.equal(videoCanvasDocumentSchema.parse({ ...canvas, brief: { objective: "Explain the verified product", targetAudience: "Aftermarket distributors" } }).brief?.targetAudience, "Aftermarket distributors");
const configuredCanvas = {
  ...canvas,
  nodes: [...canvas.nodes, { id: "scene-demo", position: { x: 300, y: 300 }, data: { label: "Scene" } }],
  edges: [...canvas.edges, { id: "scene-demo-generate", source: "scene-demo", target: "generate" }],
  assetBinding: { assetRef: "asset-product-001", rightsEvidenceRef: "evidence-rights-001" },
  platforms: ["youtube", "tiktok"],
  scenes: { "scene-demo": { prompt: "Show the rights-cleared product image.", durationSeconds: 5 } },
};
assert.equal(videoCanvasDocumentSchema.parse(configuredCanvas).scenes?.["scene-demo"]?.durationSeconds, 5);
assert.equal(videoCanvasDocumentSchema.parse({ ...configuredCanvas, nodes: [...configuredCanvas.nodes, { id: "scene-later", position: { x: 400, y: 360 }, data: { label: "Later" } }] }).nodes.length, 6);
assert.throws(() => videoCanvasDocumentSchema.parse({ ...canvas, version: 2 }), /Invalid input/);
assert.throws(() => saveVideoCanvasSchema.parse({ expectedRevision: -1, document: canvas }), /Too small/);
assert.throws(() => videoCanvasDocumentSchema.parse({ ...canvas, factBinding: { productId: "019a4c5c-1685-7f24-935b-2c27f7bbcc96", factPath: "engineering.oe_number" } }), /已核验/);
assert.throws(() => videoCanvasDocumentSchema.parse({ ...canvas, brief: { objective: "", targetAudience: "Aftermarket distributors" } }), /营销目标/);
assert.throws(() => videoCanvasDocumentSchema.parse({ ...canvas, scenes: { "scene-missing": { prompt: "Show the product.", durationSeconds: 5 } } }), /关联到画布/);
assert.throws(() => videoCanvasDocumentSchema.parse({ ...canvas, edges: [...canvas.edges, { id: "loop", source: "generate", target: "brief" }] }), /方向不符合|环路/);
assert.throws(() => videoCanvasDocumentSchema.parse({ ...canvas, edges: [...canvas.edges, { id: "duplicate", source: "facts", target: "generate" }] }), /只能有一条/);
assert.throws(() => videoCanvasDocumentSchema.parse({ ...canvas, edges: canvas.edges.map((edge) => edge.id === "brief-facts" ? { ...edge, id: "other-edge" } : edge) }), /缺少必要连线/);

console.log("PASS video contracts, canvas persistence, and advisory creative transitions");
