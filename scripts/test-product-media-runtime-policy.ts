import assert from "node:assert/strict";

import { type VideoProject, videoProjectSchema } from "../lib/video/contracts";
import {
  assertCurrentProductMediaUsage,
  type CurrentProductMediaRecord,
  productMediaIdsForVideoProject,
  productMediaRuntimeRecordFromRow,
} from "../lib/video/product-media-runtime-policy";

const evaluatedAt = new Date("2026-09-03T12:00:00.000Z");
const productId = "00000000-0000-4000-8000-000000000951";
const mediaId = "00000000-0000-4000-8000-000000000952";

const project: VideoProject = videoProjectSchema.parse({
  id: "00000000-0000-4000-8000-000000000953",
  productId,
  status: "draft",
  objective: "Create a distributor inquiry video",
  targetAudience: "Overseas distributors",
  platforms: ["facebook"],
  factualClaims: [
    {
      field: "product.product_name",
      value: "Verified clutch kit",
      evidenceRef: "evidence-product-name-951",
    },
  ],
  sourceAssets: [
    {
      assetRef: "evidence-product-media-951",
      mediaType: "image",
      rightsEvidenceRef: "evidence-product-rights-951",
      productMediaId: mediaId,
    },
  ],
  scenes: [
    {
      sceneId: "scene-001",
      prompt: "Use the approved product image",
      durationSeconds: 3,
      claimRefs: [],
      assetRefs: ["evidence-product-media-951"],
    },
  ],
  approvalRefs: [],
  editDraft: {
    version: 2,
    platform: "facebook",
    clips: [
      {
        clipId: "clip-001",
        assetRef: "evidence-product-media-951",
        mediaType: "image",
        trimStartMs: 0,
        durationMs: 3_000,
        fitMode: "contain",
        audioMode: "muted",
        caption: { kind: "none" },
      },
    ],
    ctaText: "Contact us",
  },
});

const record: CurrentProductMediaRecord = {
  id: mediaId,
  productId,
  evidenceRef: "evidence-product-media-951",
  mediaType: "image",
  rightsEvidenceRef: "evidence-product-rights-951",
  editingAllowed: true,
  publicDistributionAllowed: true,
  paidAdvertisingAllowed: false,
  rightsExpiresAt: new Date("2027-09-03T00:00:00.000Z"),
  reviewStatus: "approved",
};

assert.deepEqual(productMediaIdsForVideoProject(project), [mediaId]);
assert.deepEqual(assertCurrentProductMediaUsage(project, [record], "organic", evaluatedAt), [
  record,
]);
assert.throws(
  () => assertCurrentProductMediaUsage(project, [], "organic", evaluatedAt),
  /已不存在/,
);
assert.throws(
  () =>
    assertCurrentProductMediaUsage(
      project,
      [{ ...record, reviewStatus: "rejected" }],
      "organic",
      evaluatedAt,
    ),
  /撤销|拒绝/,
);
assert.throws(
  () =>
    assertCurrentProductMediaUsage(
      project,
      [{ ...record, rightsExpiresAt: evaluatedAt }],
      "organic",
      evaluatedAt,
    ),
  /已经过期/,
);
assert.throws(
  () =>
    assertCurrentProductMediaUsage(
      project,
      [{ ...record, editingAllowed: false }],
      "organic",
      evaluatedAt,
    ),
  /不允许剪辑/,
);
assert.throws(
  () =>
    assertCurrentProductMediaUsage(
      project,
      [{ ...record, publicDistributionAllowed: false }],
      "organic",
      evaluatedAt,
    ),
  /不允许公开发布/,
);
assert.throws(
  () => assertCurrentProductMediaUsage(project, [record], "paid_advertising", evaluatedAt),
  /付费广告授权/,
);
assert.throws(
  () =>
    assertCurrentProductMediaUsage(
      project,
      [{ ...record, evidenceRef: "evidence-replaced-media-951" }],
      "organic",
      evaluatedAt,
    ),
  /源文件证据已经变化/,
);
assert.throws(
  () =>
    assertCurrentProductMediaUsage(
      project,
      [{ ...record, rightsEvidenceRef: "evidence-replaced-rights-951" }],
      "organic",
      evaluatedAt,
    ),
  /权利证据已经变化/,
);
assert.throws(
  () =>
    assertCurrentProductMediaUsage(
      project,
      [{ ...record, productId: "00000000-0000-4000-8000-000000000999" }],
      "organic",
      evaluatedAt,
    ),
  /属于其他产品/,
);
assert.throws(
  () => assertCurrentProductMediaUsage(project, [record, record], "organic", evaluatedAt),
  /记录重复/,
);

const uploadOnly = videoProjectSchema.parse({
  ...project,
  sourceAssets: [
    {
      assetRef: "evidence-one-off-upload-951",
      mediaType: "image",
      rightsEvidenceRef: "evidence-one-off-rights-951",
    },
  ],
  scenes: [
    {
      ...project.scenes[0],
      assetRefs: ["evidence-one-off-upload-951"],
    },
  ],
  editDraft: {
    ...project.editDraft,
    clips: [
      {
        ...project.editDraft!.clips[0],
        assetRef: "evidence-one-off-upload-951",
      },
    ],
  },
});
assert.deepEqual(productMediaIdsForVideoProject(uploadOnly), []);
assert.deepEqual(assertCurrentProductMediaUsage(uploadOnly, [], "organic", evaluatedAt), []);

assert.throws(
  () =>
    videoProjectSchema.parse({
      ...project,
      sourceAssets: [
        {
          ...project.sourceAssets[0],
          assetRef: "asset-not-evidence-951",
        },
      ],
      scenes: [{ ...project.scenes[0], assetRefs: ["asset-not-evidence-951"] }],
      editDraft: {
        ...project.editDraft,
        clips: [{ ...project.editDraft!.clips[0], assetRef: "asset-not-evidence-951" }],
      },
    }),
  /ProductMedia 源文件/,
);

const fromRow = productMediaRuntimeRecordFromRow({
  id: mediaId,
  productId,
  evidenceId: record.evidenceRef,
  mediaType: record.mediaType,
  rightsEvidenceRef: record.rightsEvidenceRef,
  editingAllowed: true,
  publicDistributionAllowed: true,
  paidAdvertisingAllowed: false,
  rightsExpiresAt: record.rightsExpiresAt,
  reviewStatus: "approved",
});
assert.equal(fromRow.id, mediaId);
assert.equal(fromRow.rightsExpiresAt?.toISOString(), "2027-09-03T00:00:00.000Z");

console.log("PASS ProductMedia is revalidated before AI editing, rendering, and approval");
