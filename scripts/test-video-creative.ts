import assert from "node:assert/strict";
import { buildVideoCreative } from "../lib/video/creative";
import type { ProductReady } from "../lib/product/verification";

const id = "00000000-0000-4000-8000-000000000101";
const product: ProductReady = { record_id: id, source_ref: "source-product-101", evidence_refs: ["evidence-product-101"], field_evidence: { "product.product_name": "evidence-product-101" }, verification_status: "verified", blocking_missing_fields: [], optional_missing_fields: [], product: { product_name: "Synthetic clutch" }, approval_ref: "approval-product-101" };
const creative = buildVideoCreative({ productId: id, objective: "Explain a verified product", targetAudience: "Synthetic distributor", factPaths: ["product.product_name"], sourceAssets: [{ assetRef: "asset-product-101", mediaType: "image", rightsEvidenceRef: "evidence-rights-101" }], platforms: ["youtube"], scenes: [{ prompt: "Use approved product image.", durationSeconds: 5, claimRefs: ["product.product_name"], assetRefs: ["asset-product-101"] }] }, product, "00000000-0000-4000-8000-000000000102");
assert.equal(creative.status, "ready_for_generation");
assert.equal(creative.factualClaims[0]?.evidenceRef, "evidence-product-101");
assert.throws(() => buildVideoCreative({ productId: id, objective: "x", targetAudience: "y", factPaths: ["product.oe_numbers"], sourceAssets: [], platforms: ["youtube"], scenes: [{ prompt: "x", durationSeconds: 1, claimRefs: ["product.oe_numbers"], assetRefs: [] }] }, product), /没有有效/);
console.log("PASS evidence-bound video creative ready for generation");
