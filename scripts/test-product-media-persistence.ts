import assert from "node:assert/strict";

import {
  applyProductMediaReview,
  createPendingProductMediaAsset,
  registerProductMediaInputSchema,
} from "../lib/product/media-service";
import type { ProductReady } from "../lib/product/verification";

const productId = "00000000-0000-4000-8000-000000000301";
const assetId = "00000000-0000-4000-8000-000000000302";
const product: ProductReady = {
  record_id: productId,
  source_ref: "source-product-301",
  evidence_refs: [
    "evidence-product-name-301",
    "evidence-product-type-301",
    "evidence-product-sku-301",
    "evidence-product-oe-301",
    "evidence-product-approval-301",
  ],
  field_evidence: {
    "product.product_name": "evidence-product-name-301",
    "product.product_type": "evidence-product-type-301",
    "product.internal_sku": "evidence-product-sku-301",
    "product.oe_numbers": "evidence-product-oe-301",
  },
  verification_status: "verified",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Verified clutch kit",
    product_type: "clutch_kit",
    internal_sku: "FT-CL-301",
    oe_numbers: ["OE-301"],
  },
  specifications: {},
  commercial: {},
  approval_ref: "approval-product-301",
};

const input = {
  productId,
  evidenceRef: "evidence-media-301",
  origin: "factory" as const,
  semantic: {
    role: "product_hero" as const,
    description: "Authorized front product image",
    tags: ["front", "product"],
    productVisible: true,
    logoVisible: false,
    textPresent: false,
  },
  rights: {
    rightsEvidenceRef: "evidence-rights-301",
    editingAllowed: true,
    publicDistributionAllowed: true,
    paidAdvertisingAllowed: false,
    imageToVideoAllowed: false,
    referenceToVideoAllowed: false,
    expiresAt: null,
  },
};

const probe = {
  mediaType: "image" as const,
  technical: {
    contentType: "image/jpeg",
    width: 1600,
    height: 1600,
    durationMs: null,
    fps: null,
    hasAudio: false,
  },
};

const evidence = [
  { id: "evidence-media-301", contentType: "image/jpeg" },
  { id: "evidence-rights-301", contentType: "application/json" },
  { id: "evidence-review-301", contentType: "application/json" },
  { id: "evidence-revocation-301", contentType: "application/json" },
];

const pending = createPendingProductMediaAsset(input, probe, product, evidence, {
  id: assetId,
  createdAt: new Date("2026-09-02T12:00:00.000Z"),
});
assert.equal(pending.id, assetId);
assert.equal(pending.productId, productId);
assert.equal(pending.review.status, "pending");
assert.equal(pending.review.reviewedBy, null);
assert.equal(pending.createdAt, "2026-09-02T12:00:00.000Z");

assert.throws(
  () =>
    registerProductMediaInputSchema.parse({
      ...input,
      mediaType: "image",
      technical: probe.technical,
    }),
  /Unrecognized key|unrecognized/i,
);

assert.throws(
  () =>
    createPendingProductMediaAsset(
      { ...input, productId: "00000000-0000-4000-8000-000000000399" },
      probe,
      product,
      evidence,
    ),
  /ProductReady/,
);

assert.throws(
  () =>
    createPendingProductMediaAsset(
      input,
      probe,
      product,
      evidence.filter((item) => item.id !== "evidence-rights-301"),
    ),
  /权利证据不存在/,
);
assert.throws(
  () =>
    createPendingProductMediaAsset(
      input,
      {
        ...probe,
        technical: { ...probe.technical, contentType: "image/png" },
      },
      product,
      evidence,
    ),
  /探测类型/,
);
assert.throws(
  () =>
    createPendingProductMediaAsset(
      input,
      {
        mediaType: "video",
        technical: { ...probe.technical, contentType: "video/mp4" },
      },
      product,
      evidence,
    ),
  /视频探测结果/,
);

const approved = applyProductMediaReview(
  pending,
  {
    assetId,
    decision: "approved",
    evidenceRef: "evidence-review-301",
    notes: "Rights and product identity checked by an administrator.",
  },
  "user-admin-301",
  evidence,
  new Date("2026-09-02T13:00:00.000Z"),
);
assert.equal(approved.review.status, "approved");
assert.equal(approved.review.reviewedBy, "user-admin-301");
assert.equal(approved.review.evidenceRef, "evidence-review-301");
assert.equal(approved.review.reviewedAt, "2026-09-02T13:00:00.000Z");

assert.throws(
  () =>
    applyProductMediaReview(
      approved,
      { assetId, decision: "rejected", evidenceRef: "evidence-revocation-301", notes: "" },
      "user-admin-301",
      evidence,
    ),
  /必须填写原因/,
);

const revoked = applyProductMediaReview(
  approved,
  {
    assetId,
    decision: "rejected",
    evidenceRef: "evidence-revocation-301",
    notes: "The factory withdrew public-distribution permission.",
  },
  "user-admin-302",
  evidence,
  new Date("2026-09-02T14:00:00.000Z"),
);
assert.equal(revoked.review.status, "rejected");
assert.equal(revoked.review.reviewedBy, "user-admin-302");
assert.equal(revoked.review.evidenceRef, "evidence-revocation-301");
assert.equal(revoked.review.reviewedAt, "2026-09-02T14:00:00.000Z");

assert.throws(
  () =>
    applyProductMediaReview(
      revoked,
      { assetId, decision: "approved", evidenceRef: "evidence-review-301", notes: "" },
      "user-admin-301",
      evidence,
    ),
  /状态不允许/,
);

assert.throws(
  () =>
    applyProductMediaReview(
      pending,
      {
        assetId: "00000000-0000-4000-8000-000000000398",
        decision: "approved",
        evidenceRef: "evidence-review-301",
        notes: "",
      },
      "user-admin-301",
      evidence,
    ),
  /不匹配/,
);

assert.throws(
  () =>
    applyProductMediaReview(
      pending,
      { assetId, decision: "approved", evidenceRef: "evidence-review-missing", notes: "" },
      "user-admin-301",
      evidence,
    ),
  /审核证据不存在/,
);

assert.throws(
  () =>
    applyProductMediaReview(
      pending,
      { assetId, decision: "approved", evidenceRef: "evidence-review-301", notes: "" },
      "user-admin-301",
      evidence,
      new Date("invalid"),
    ),
  /审核时间无效/,
);

console.log(
  "PASS ProductMedia registration, trusted probing, review, and revocation remain evidence-bound",
);
