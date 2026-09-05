import assert from "node:assert/strict";

import type { ProductReady } from "../lib/product/verification";
import { selectProductVideoMedia } from "../lib/product/video-media-selection";
import { type ProductMediaAsset, productMediaAssetSchema } from "../lib/product/video-readiness";

const evaluatedAt = new Date("2026-09-03T00:00:00.000Z");
const productId = "00000000-0000-4000-8000-000000000801";
const heroId = "00000000-0000-4000-8000-000000000802";
const pendingId = "00000000-0000-4000-8000-000000000803";

const product: ProductReady = {
  record_id: productId,
  source_ref: "source-product-801",
  evidence_refs: [
    "evidence-product-name-801",
    "evidence-product-type-801",
    "evidence-product-sku-801",
    "evidence-product-oe-801",
    "evidence-product-approval-801",
  ],
  field_evidence: {
    "product.product_name": "evidence-product-name-801",
    "product.product_type": "evidence-product-type-801",
    "product.internal_sku": "evidence-product-sku-801",
    "product.oe_numbers": "evidence-product-oe-801",
  },
  verification_status: "verified",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Verified clutch kit",
    product_type: "clutch_kit",
    internal_sku: "FT-CL-801",
    oe_numbers: ["OE-801"],
  },
  specifications: {},
  commercial: {},
  approval_ref: "approval-product-801",
};

function asset(overrides: Partial<ProductMediaAsset> = {}): ProductMediaAsset {
  return productMediaAssetSchema.parse({
    id: heroId,
    productId,
    evidenceRef: "evidence-media-801",
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
      description: "Authorized product image",
      tags: ["product", "hero"],
      productVisible: true,
      logoVisible: false,
      textPresent: false,
    },
    rights: {
      rightsEvidenceRef: "evidence-rights-801",
      editingAllowed: true,
      publicDistributionAllowed: true,
      paidAdvertisingAllowed: false,
      imageToVideoAllowed: false,
      referenceToVideoAllowed: false,
      expiresAt: "2027-09-03T00:00:00.000Z",
    },
    review: {
      status: "approved",
      reviewedBy: "admin-801",
      reviewedAt: "2026-09-02T12:00:00.000Z",
      evidenceRef: "evidence-review-801",
      notes: "Rights and visible identity confirmed.",
    },
    createdAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  });
}

const hero = asset();
const selected = selectProductVideoMedia(
  product,
  [hero],
  {
    productId,
    assetIds: [heroId],
    usage: "organic",
  },
  evaluatedAt,
);
assert.equal(selected.assessment.status, "ready");
assert.deepEqual(selected.sourceAssets, [
  {
    assetRef: "evidence-media-801",
    mediaType: "image",
    rightsEvidenceRef: "evidence-rights-801",
    productMediaId: heroId,
  },
]);
assert.equal("signedGetUrl" in selected.sourceAssets[0]!, false);

assert.throws(
  () =>
    selectProductVideoMedia(
      product,
      [hero],
      {
        productId,
        assetIds: [heroId],
        usage: "paid_advertising",
      },
      evaluatedAt,
    ),
  /付费广告授权/,
);

assert.throws(
  () =>
    selectProductVideoMedia(
      product,
      [hero],
      {
        productId,
        assetIds: [heroId, heroId],
        usage: "organic",
      },
      evaluatedAt,
    ),
  /不能重复选择/,
);

const pending = asset({
  id: pendingId,
  evidenceRef: "evidence-media-802",
  review: {
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    evidenceRef: null,
    notes: "",
  },
});
assert.throws(
  () =>
    selectProductVideoMedia(
      product,
      [hero, pending],
      {
        productId,
        assetIds: [pendingId],
        usage: "organic",
      },
      evaluatedAt,
    ),
  /当前未通过审核/,
);

const expired = asset({
  rights: {
    ...hero.rights,
    expiresAt: "2026-09-02T23:59:59.000Z",
  },
});
assert.throws(
  () =>
    selectProductVideoMedia(
      product,
      [expired],
      {
        productId,
        assetIds: [heroId],
        usage: "organic",
      },
      evaluatedAt,
    ),
  /授权已经过期|没有同时满足/,
);

const otherProduct = asset({
  id: "00000000-0000-4000-8000-000000000805",
  productId: "00000000-0000-4000-8000-000000000899",
  evidenceRef: "evidence-media-805",
});
assert.throws(
  () =>
    selectProductVideoMedia(
      product,
      [hero, otherProduct],
      {
        productId,
        assetIds: [otherProduct.id],
        usage: "organic",
      },
      evaluatedAt,
    ),
  /属于其他产品/,
);

const shortVideo = asset({
  id: "00000000-0000-4000-8000-000000000804",
  evidenceRef: "evidence-media-804",
  mediaType: "video",
  technical: {
    contentType: "video/mp4",
    width: 1080,
    height: 1920,
    durationMs: 500,
    fps: 30,
    hasAudio: false,
  },
  rights: {
    ...hero.rights,
    imageToVideoAllowed: false,
  },
});
assert.throws(
  () =>
    selectProductVideoMedia(
      product,
      [shortVideo],
      {
        productId,
        assetIds: [shortVideo.id],
        usage: "organic",
      },
      evaluatedAt,
    ),
  /不足 1 秒/,
);

console.log("PASS governed ProductMedia selection produces private editing sources only");
