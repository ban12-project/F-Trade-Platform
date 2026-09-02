import assert from "node:assert/strict";

import {
  assessStoredProductVideoReadiness,
  decideProductMediaRecord,
  productMediaAssets,
  registerProductMediaRecord,
} from "../lib/product/product-media-store";
import type { ProductReady } from "../lib/product/verification";

const productId = "00000000-0000-4000-8000-000000000401";
const assetId = "00000000-0000-4000-8000-000000000402";
const createdAt = new Date("2026-09-03T00:00:00.000Z");
const reviewedAt = new Date("2026-09-03T01:00:00.000Z");

const product: ProductReady = {
  record_id: productId,
  source_ref: "source-product-401",
  evidence_refs: [
    "evidence-product-name-401",
    "evidence-product-type-401",
    "evidence-product-sku-401",
    "evidence-product-oe-401",
    "evidence-product-approval-401",
  ],
  field_evidence: {
    "product.product_name": "evidence-product-name-401",
    "product.product_type": "evidence-product-type-401",
    "product.internal_sku": "evidence-product-sku-401",
    "product.oe_numbers": "evidence-product-oe-401",
  },
  verification_status: "verified",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Synthetic clutch kit",
    product_type: "clutch_kit",
    internal_sku: "SYN-401",
    oe_numbers: ["OE-401"],
  },
  approval_ref: "approval-product-401",
};

const registration = {
  productId,
  evidenceRef: "evidence-media-source-401",
  mediaType: "image" as const,
  origin: "factory" as const,
  technical: {
    contentType: "image/jpeg",
    width: 1600,
    height: 1600,
    durationMs: null,
    fps: null,
    hasAudio: false,
  },
  semantic: {
    role: "product_hero" as const,
    description: "Front-facing authorized product photograph",
    tags: ["product", "hero"],
    productVisible: true,
    logoVisible: false,
    textPresent: false,
  },
  rights: {
    rightsEvidenceRef: "evidence-media-rights-401",
    editingAllowed: true,
    publicDistributionAllowed: true,
    paidAdvertisingAllowed: true,
    imageToVideoAllowed: true,
    referenceToVideoAllowed: false,
    expiresAt: null,
  },
};

const pending = registerProductMediaRecord(product, registration, { assetId, createdAt });
assert.equal(productMediaAssets(pending).length, 1);
assert.equal(productMediaAssets(pending)[0]?.review.status, "pending");
assert.equal(productMediaAssets(pending)[0]?.id, assetId);
assert.ok(pending.evidence_refs.includes(registration.evidenceRef));
assert.ok(pending.evidence_refs.includes(registration.rights.rightsEvidenceRef));
assert.equal(assessStoredProductVideoReadiness(pending, createdAt).status, "review_required");

assert.throws(
  () => registerProductMediaRecord(pending, registration, { assetId: "00000000-0000-4000-8000-000000000403", createdAt }),
  /已经登记/,
);
assert.throws(
  () => registerProductMediaRecord(product, { ...registration, productId: "00000000-0000-4000-8000-000000000499" }, { assetId, createdAt }),
  /当前 ProductReady/,
);

const approved = decideProductMediaRecord(pending, {
  assetId,
  outcome: "approved",
  evidenceRef: "evidence-media-review-401",
  notes: "Rights and visible product identity confirmed.",
}, "reviewer-401", reviewedAt);
const approvedAsset = productMediaAssets(approved)[0]!;
assert.equal(approvedAsset.review.status, "approved");
assert.equal(approvedAsset.review.reviewedBy, "reviewer-401");
assert.equal(approvedAsset.review.reviewedAt, reviewedAt.toISOString());
assert.ok(approved.evidence_refs.includes("evidence-media-review-401"));
const ready = assessStoredProductVideoReadiness(approved, reviewedAt);
assert.equal(ready.status, "ready");
assert.deepEqual(ready.editingEligibleAssetIds, [assetId]);
assert.deepEqual(ready.generativeUse.imageToVideoAssetIds, [assetId]);

assert.throws(
  () => decideProductMediaRecord(approved, {
    assetId,
    outcome: "rejected",
    evidenceRef: "evidence-media-review-402",
    notes: "Second decision must fail.",
  }, "reviewer-402", reviewedAt),
  /不能重复决定/,
);
assert.throws(
  () => decideProductMediaRecord(pending, {
    assetId: "00000000-0000-4000-8000-000000000498",
    outcome: "approved",
    evidenceRef: "evidence-media-review-403",
    notes: "Unknown asset.",
  }, "reviewer-403", reviewedAt),
  /不存在/,
);

const rejected = decideProductMediaRecord(pending, {
  assetId,
  outcome: "rejected",
  evidenceRef: "evidence-media-review-404",
  notes: "Synthetic rejection path.",
}, "reviewer-404", reviewedAt);
assert.equal(assessStoredProductVideoReadiness(rejected, reviewedAt).status, "not_ready");
assert.ok(assessStoredProductVideoReadiness(rejected, reviewedAt).warnings.some((issue) => issue.code === "media_rejected"));

console.log("PASS ProductMedia registration and review preserve ProductReady facts and drive VideoReady");
