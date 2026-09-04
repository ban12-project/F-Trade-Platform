import assert from "node:assert/strict";
import type { ProductReady } from "../lib/product/verification";
import { videoProjectSchema } from "../lib/video/contracts";
import { assertCurrentProductFacts } from "../lib/video/product-fact-runtime-policy";

const productId = "00000000-0000-4000-8000-000000000551";
const factValues = {
  "product.oe_numbers": "OE-551",
  "specifications.clutch_diameter_mm": "280",
  "specifications.spline_count": "24",
  "commercial.moq": "50",
  "commercial.estimated_lead_time_days": "21",
} as const;
const fieldEvidence = Object.fromEntries(
  [
    "product.product_name",
    "product.product_type",
    "product.internal_sku",
    ...Object.keys(factValues),
  ].map((field) => [field, `evidence-${field.replaceAll(".", "-").replaceAll("_", "-")}-551`]),
);
const product: ProductReady = {
  record_id: productId,
  source_ref: "source-product-551",
  evidence_refs: [...Object.values(fieldEvidence), "evidence-approval-551"],
  field_evidence: fieldEvidence,
  verification_status: "verified",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Verified clutch kit",
    product_type: "clutch_kit",
    internal_sku: "FT-CL-551",
    oe_numbers: ["OE-551"],
  },
  specifications: { clutch_diameter_mm: 280, spline_count: 24 },
  commercial: { moq: 50, estimated_lead_time_days: 21 },
  approval_ref: "approval-product-551",
};
const project = videoProjectSchema.parse({
  id: "00000000-0000-4000-8000-000000000552",
  productId,
  status: "draft",
  objective: "Verified product facts",
  targetAudience: "Distributors",
  platforms: ["facebook"],
  factualClaims: Object.entries(factValues).map(([field, value]) => ({
    field,
    value,
    evidenceRef: fieldEvidence[field],
  })),
  sourceAssets: [
    {
      assetRef: "evidence-source-551",
      mediaType: "image",
      rightsEvidenceRef: "evidence-rights-551",
    },
  ],
  scenes: [
    {
      sceneId: "scene-551",
      prompt: "Authorized product image",
      durationSeconds: 5,
      claimRefs: [],
      assetRefs: ["evidence-source-551"],
    },
  ],
  approvalRefs: [],
  editDraft: {
    version: 2,
    platform: "facebook",
    clips: [
      {
        clipId: "clip-551",
        assetRef: "evidence-source-551",
        mediaType: "image",
        trimStartMs: 0,
        durationMs: 5_000,
        fitMode: "contain",
        audioMode: "muted",
        caption: { kind: "verified_fact", claimRef: "product.oe_numbers" },
      },
    ],
    ctaText: "Contact us",
  },
});

assert.equal(assertCurrentProductFacts(project, product).record_id, productId);
for (const [section, field, wrongValue] of [
  ["product", "oe_numbers", ["OE-999"]],
  ["specifications", "clutch_diameter_mm", 300],
  ["specifications", "spline_count", 10],
  ["commercial", "moq", 1],
  ["commercial", "estimated_lead_time_days", 7],
] as const) {
  assert.throws(
    () =>
      assertCurrentProductFacts(project, {
        ...product,
        [section]: { ...product[section], [field]: wrongValue },
      }),
    /不是当前 ProductReady/,
  );
}
assert.throws(
  () =>
    assertCurrentProductFacts(project, {
      ...product,
      field_evidence: {
        ...product.field_evidence,
        "product.oe_numbers": "evidence-replaced-oe-551",
      },
      evidence_refs: [...product.evidence_refs, "evidence-replaced-oe-551"],
    }),
  /不是当前 ProductReady/,
);
assert.throws(
  () =>
    assertCurrentProductFacts(project, {
      ...product,
      record_id: "00000000-0000-4000-8000-000000000599",
    }),
  /匹配的 ProductReady/,
);

console.log("PASS video facts are revalidated against current ProductReady values and evidence");
