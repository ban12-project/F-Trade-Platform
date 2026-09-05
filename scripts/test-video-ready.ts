import assert from "node:assert/strict";

import type { ProductDraft, ProductReady } from "../lib/product/verification";
import {
  assessProductVideoReadiness,
  type ProductMediaAsset,
  productMediaAssetSchema,
} from "../lib/product/video-readiness";

const evaluatedAt = new Date("2026-09-02T00:00:00.000Z");
const productId = "00000000-0000-4000-8000-000000000201";
const product: ProductReady = {
  record_id: productId,
  source_ref: "source-product-201",
  evidence_refs: [
    "evidence-product-name-201",
    "evidence-product-type-201",
    "evidence-product-sku-201",
    "evidence-product-oe-201",
    "evidence-product-approval-201",
  ],
  field_evidence: {
    "product.product_name": "evidence-product-name-201",
    "product.product_type": "evidence-product-type-201",
    "product.internal_sku": "evidence-product-sku-201",
    "product.oe_numbers": "evidence-product-oe-201",
  },
  verification_status: "verified",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Verified clutch kit",
    product_type: "clutch_kit",
    internal_sku: "FT-CL-201",
    oe_numbers: ["12345"],
  },
  specifications: {},
  commercial: {},
  approval_ref: "approval-product-201",
};

const baseAsset: ProductMediaAsset = productMediaAssetSchema.parse({
  id: "00000000-0000-4000-8000-000000000202",
  productId,
  evidenceRef: "evidence-media-202",
  mediaType: "image",
  origin: "factory",
  technical: {
    contentType: "image/jpeg",
    width: 1600,
    height: 1600,
    durationMs: null,
    fps: null,
    hasAudio: false,
  },
  semantic: {
    role: "product_hero",
    description: "Front product view on a neutral background",
    tags: ["product", "front-view"],
    productVisible: true,
    logoVisible: false,
    textPresent: false,
  },
  rights: {
    rightsEvidenceRef: "evidence-rights-202",
    editingAllowed: true,
    publicDistributionAllowed: true,
    paidAdvertisingAllowed: false,
    imageToVideoAllowed: true,
    referenceToVideoAllowed: false,
    expiresAt: null,
  },
  review: {
    status: "approved",
    reviewedBy: "user-admin-201",
    reviewedAt: "2026-09-01T10:00:00.000Z",
    evidenceRef: "evidence-review-202",
    notes: "Factory authorization verified.",
  },
  createdAt: "2026-09-01T09:00:00.000Z",
});

const ready = assessProductVideoReadiness(product, [baseAsset], evaluatedAt);
assert.equal(ready.status, "ready");
assert.deepEqual(ready.editingEligibleAssetIds, [baseAsset.id]);
assert.deepEqual(ready.generativeUse.imageToVideoAssetIds, [baseAsset.id]);
assert.deepEqual(ready.generativeUse.referenceToVideoAssetIds, []);
assert.ok(ready.verifiedFactPaths.includes("product.product_name"));
assert.ok(ready.verifiedFactPaths.includes("product.oe_numbers"));
assert.equal(ready.blockers.length, 0);

const withoutMedia = assessProductVideoReadiness(product, [], evaluatedAt);
assert.equal(withoutMedia.status, "not_ready");
assert.ok(withoutMedia.blockers.some((issue) => issue.code === "missing_product_media"));

const pendingAsset = productMediaAssetSchema.parse({
  ...baseAsset,
  id: "00000000-0000-4000-8000-000000000203",
  review: {
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    evidenceRef: null,
    notes: "",
  },
});
const pending = assessProductVideoReadiness(product, [pendingAsset], evaluatedAt);
assert.equal(pending.status, "review_required");
assert.ok(pending.blockers.some((issue) => issue.code === "media_pending_review"));
assert.deepEqual(pending.editingEligibleAssetIds, []);

const expiredAsset = productMediaAssetSchema.parse({
  ...baseAsset,
  id: "00000000-0000-4000-8000-000000000204",
  rights: {
    ...baseAsset.rights,
    expiresAt: "2026-09-01T00:00:00.000Z",
  },
});
const expired = assessProductVideoReadiness(product, [expiredAsset], evaluatedAt);
assert.equal(expired.status, "not_ready");
assert.ok(expired.warnings.some((issue) => issue.code === "media_rights_expired"));
assert.ok(expired.blockers.some((issue) => issue.code === "no_editing_eligible_media"));

const editingOnlyAsset = productMediaAssetSchema.parse({
  ...baseAsset,
  id: "00000000-0000-4000-8000-000000000205",
  rights: {
    ...baseAsset.rights,
    imageToVideoAllowed: false,
    referenceToVideoAllowed: false,
  },
});
const editingOnly = assessProductVideoReadiness(product, [editingOnlyAsset], evaluatedAt);
assert.equal(editingOnly.status, "ready");
assert.deepEqual(editingOnly.editingEligibleAssetIds, [editingOnlyAsset.id]);
assert.deepEqual(editingOnly.generativeUse.imageToVideoAssetIds, []);
assert.ok(editingOnly.warnings.some((issue) => issue.code === "no_generation_eligible_media"));

const unverifiedProduct: ProductDraft = {
  ...product,
  verification_status: "review_required",
  blocking_missing_fields: [],
};
const unverified = assessProductVideoReadiness(unverifiedProduct, [baseAsset], evaluatedAt);
assert.equal(unverified.status, "not_ready");
assert.ok(unverified.blockers.some((issue) => issue.code === "product_not_ready"));

assert.throws(
  () =>
    productMediaAssetSchema.parse({
      ...baseAsset,
      technical: { ...baseAsset.technical, durationMs: 1_000 },
    }),
  /图片不能包含/,
);

assert.throws(
  () =>
    productMediaAssetSchema.parse({
      ...baseAsset,
      review: {
        status: "approved",
        reviewedBy: null,
        reviewedAt: null,
        evidenceRef: null,
        notes: "",
      },
    }),
  /审核必须记录/,
);

assert.throws(
  () =>
    productMediaAssetSchema.parse({
      ...baseAsset,
      rights: {
        ...baseAsset.rights,
        editingAllowed: false,
        imageToVideoAllowed: true,
      },
    }),
  /编辑授权/,
);

assert.throws(
  () => assessProductVideoReadiness(product, [baseAsset, baseAsset], evaluatedAt),
  /产品媒体标识不能重复/,
);
assert.throws(
  () => assessProductVideoReadiness(product, [baseAsset], new Date("invalid")),
  /评估时间无效/,
);

console.log("PASS ProductMedia rights and VideoReady remain evidence-bound and generation-safe");
