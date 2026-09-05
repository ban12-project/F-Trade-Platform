import assert from "node:assert/strict";

import { productReviewFormSchema } from "../lib/form-schemas";
import { productCatalogFormSchema } from "../lib/product/catalog-form-schema";
import { buildEvidenceBoundProductCatalogDraft } from "../lib/product/evidence-bound-catalog";
import { approveProductDraft, rejectProductDraft } from "../lib/product/verification";
import { productCatalogDisplayIdentity } from "../lib/products";
import { assertTransition } from "../lib/workflow/transitions";

const validInput = productCatalogFormSchema.parse({
  productName: "Synthetic clutch disc",
  productNameEvidenceRef: "evidence-catalog-title-001",
  productType: "clutch_disc",
  productTypeEvidenceRef: "evidence-catalog-title-001",
  internalSku: "SYN-DISC-001",
  internalSkuEvidenceRef: "evidence-catalog-sku-001",
  oeNumbers: "",
  oeNumbersEvidenceRef: "",
  application: "",
  applicationEvidenceRef: "",
  vehicleBrand: "",
  vehicleBrandEvidenceRef: "",
  vehicleModel: "",
  vehicleModelEvidenceRef: "",
  clutchDiameterMm: "240",
  clutchDiameterMmEvidenceRef: "evidence-catalog-diameter-001",
  splineCount: "21",
  splineCountEvidenceRef: "evidence-catalog-spline-count-001",
  splineSize: "20 x 18",
  splineSizeEvidenceRef: "evidence-catalog-spline-size-001",
  frictionMaterial: "Synthetic material",
  frictionMaterialEvidenceRef: "evidence-catalog-material-001",
  kitContents: "",
  kitContentsEvidenceRef: "",
  grossWeightKg: "",
  grossWeightKgEvidenceRef: "",
  netWeightKg: "",
  netWeightKgEvidenceRef: "",
  packageSize: "",
  packageSizeEvidenceRef: "",
  moq: "",
  moqEvidenceRef: "",
  estimatedLeadTimeDays: "",
  estimatedLeadTimeDaysEvidenceRef: "",
  packaging: "",
  packagingEvidenceRef: "",
  supportedCustomization: "",
  supportedCustomizationEvidenceRef: "",
  sampleAvailable: "",
  sampleAvailableEvidenceRef: "",
  sourceRef: "source-catalog-001",
  projectId: "00000000-0000-4000-8000-000000000011",
});

const draft = buildEvidenceBoundProductCatalogDraft(validInput, "synthetic-product-001");
assert.equal(draft.verification_status, "review_required");
assert.ok(draft.blocking_missing_fields.includes("oe_numbers_or_verified_application"));
assert.equal(draft.field_evidence["product.product_name"], "evidence-catalog-title-001");
assert.equal(draft.field_evidence["product.product_type"], "evidence-catalog-title-001");
assert.equal(draft.field_evidence["product.internal_sku"], "evidence-catalog-sku-001");
assert.equal(
  draft.field_evidence["specifications.clutch_diameter_mm"],
  "evidence-catalog-diameter-001",
);
assert.equal(
  draft.field_evidence["specifications.spline_count"],
  "evidence-catalog-spline-count-001",
);
assert.equal(
  draft.field_evidence["specifications.spline_size"],
  "evidence-catalog-spline-size-001",
);
assert.equal(
  draft.field_evidence["specifications.friction_material"],
  "evidence-catalog-material-001",
);
assert.deepEqual(draft.evidence_refs, [
  "evidence-catalog-title-001",
  "evidence-catalog-sku-001",
  "evidence-catalog-diameter-001",
  "evidence-catalog-spline-count-001",
  "evidence-catalog-spline-size-001",
  "evidence-catalog-material-001",
]);
assert.equal(
  Object.values(draft.field_evidence).every((ref) => draft.evidence_refs.includes(ref)),
  true,
);

assert.equal(
  productCatalogFormSchema.safeParse({ ...validInput, sourceRef: "/private/tmp/catalog.pdf" })
    .success,
  false,
);
assert.equal(
  productCatalogFormSchema.safeParse({ ...validInput, clutchDiameterMm: "0" }).success,
  false,
);
assert.equal(
  productCatalogFormSchema.safeParse({ ...validInput, clutchDiameterMmEvidenceRef: "" }).success,
  false,
);
assert.equal(
  productCatalogFormSchema.safeParse({
    ...validInput,
    splineSize: "",
    splineSizeEvidenceRef: "evidence-orphaned-001",
  }).success,
  false,
);
assert.equal(
  productCatalogFormSchema.safeParse({ ...validInput, productNameEvidenceRef: "" }).success,
  false,
);
assert.equal(
  productCatalogFormSchema.safeParse({
    ...validInput,
    kitContents: "clutch_disc,pressure_plate",
    kitContentsEvidenceRef: "evidence-kit-001",
  }).success,
  false,
  "Non-kit products cannot declare kit contents",
);
assert.equal(
  productCatalogFormSchema.safeParse({
    ...validInput,
    productType: "clutch_kit",
    kitContents: "clutch_disc,flywheel",
    kitContentsEvidenceRef: "evidence-kit-001",
  }).success,
  false,
  "Unknown kit content must be rejected",
);
assert.equal(
  productCatalogFormSchema.safeParse({
    ...validInput,
    grossWeightKg: "8",
    grossWeightKgEvidenceRef: "evidence-weight-001",
    netWeightKg: "9",
    netWeightKgEvidenceRef: "evidence-weight-001",
  }).success,
  false,
  "Net weight cannot exceed gross weight",
);
assert.equal(
  productCatalogFormSchema.safeParse({
    ...validInput,
    moq: "0",
    moqEvidenceRef: "evidence-commercial-001",
  }).success,
  false,
  "MOQ must be positive",
);
assert.equal(
  productCatalogFormSchema.safeParse({
    ...validInput,
    estimatedLeadTimeDays: "-1",
    estimatedLeadTimeDaysEvidenceRef: "evidence-commercial-001",
  }).success,
  false,
  "Lead time must be non-negative",
);
assert.equal(
  productCatalogFormSchema.safeParse({
    ...validInput,
    sampleAvailable: "yes",
    sampleAvailableEvidenceRef: "",
  }).success,
  false,
  "Sample availability requires evidence",
);

const reviewerApproval = {
  approval_id: "synthetic-approval-001",
  gate: "gate_01_truth" as const,
  entity_type: "product" as const,
  entity_id: "synthetic-product-001",
  status: "approved" as const,
  decision: {
    actor_type: "human" as const,
    decided_by: "synthetic-reviewer",
    decided_at: "2026-08-25T00:00:00Z",
    evidence_ref: "evidence-review-001",
  },
};
assert.equal(
  productReviewFormSchema.safeParse({
    productId: "not-a-uuid",
    decision: "approved",
    evidenceRef: "evidence-review-001",
    notes: "",
  }).success,
  false,
);
assert.equal(
  productReviewFormSchema.safeParse({
    productId: "00000000-0000-4000-8000-000000000001",
    decision: "approved",
    evidenceRef: "/tmp/review",
    notes: "",
  }).success,
  false,
);

assert.throws(() => approveProductDraft(draft, reviewerApproval), /Product cannot be Ready/);
const revision = rejectProductDraft(draft, { ...reviewerApproval, status: "rejected" as const });
assert.equal(revision.verification_status, "revision_required");
assertTransition({
  eventId: "synthetic-revision-event-001",
  entityType: "product",
  entityId: "synthetic-product-001",
  fromState: "PRODUCT_REVISION_REQUIRED",
  toState: "PRODUCT_REVIEW_REQUIRED",
  actorType: "human",
  actorId: "synthetic-editor",
  occurredAt: "2026-08-25T00:01:00Z",
  evidenceRefs: ["evidence-product-revision-001"],
});

const completeDraft = buildEvidenceBoundProductCatalogDraft(
  {
    ...validInput,
    productName: "Synthetic clutch kit",
    productType: "clutch_kit",
    internalSku: "SYN-KIT-002",
    oeNumbers: "OE-001, OE-002, OE-001",
    oeNumbersEvidenceRef: "evidence-catalog-oe-001",
    kitContents: "clutch_disc,pressure_plate,release_bearing,clutch_disc",
    kitContentsEvidenceRef: "evidence-catalog-kit-001",
    grossWeightKg: "8.4",
    grossWeightKgEvidenceRef: "evidence-catalog-package-001",
    netWeightKg: "7.9",
    netWeightKgEvidenceRef: "evidence-catalog-package-001",
    packageSize: "40 x 40 x 12 cm",
    packageSizeEvidenceRef: "evidence-catalog-package-001",
    moq: "50",
    moqEvidenceRef: "evidence-catalog-commercial-001",
    estimatedLeadTimeDays: "0",
    estimatedLeadTimeDaysEvidenceRef: "evidence-catalog-commercial-001",
    packaging: "Neutral box",
    packagingEvidenceRef: "evidence-catalog-commercial-001",
    supportedCustomization: "Logo and color box",
    supportedCustomizationEvidenceRef: "evidence-catalog-commercial-001",
    sampleAvailable: "no",
    sampleAvailableEvidenceRef: "evidence-catalog-commercial-001",
  },
  "synthetic-product-002",
);
assert.deepEqual(completeDraft.product.oe_numbers, ["OE-001", "OE-002"]);
assert.deepEqual(completeDraft.specifications?.kit_contents, [
  "clutch_disc",
  "pressure_plate",
  "release_bearing",
]);
assert.equal(completeDraft.specifications?.gross_weight_kg, 8.4);
assert.equal(completeDraft.specifications?.net_weight_kg, 7.9);
assert.equal(completeDraft.specifications?.package_size, "40 x 40 x 12 cm");
assert.equal(completeDraft.commercial?.moq, 50);
assert.equal(completeDraft.commercial?.estimated_lead_time_days, 0);
assert.equal(completeDraft.commercial?.packaging, "Neutral box");
assert.equal(completeDraft.commercial?.supported_customization, "Logo and color box");
assert.equal(completeDraft.commercial?.sample_available, false);
assert.equal(
  completeDraft.field_evidence["specifications.kit_contents"],
  "evidence-catalog-kit-001",
);
assert.equal(
  completeDraft.field_evidence["commercial.sample_available"],
  "evidence-catalog-commercial-001",
);
assert.equal(
  completeDraft.blocking_missing_fields.includes("oe_numbers_or_verified_application"),
  false,
);
const approved = approveProductDraft(completeDraft, {
  ...reviewerApproval,
  approval_id: "synthetic-approval-002",
  entity_id: "synthetic-product-002",
});
assert.equal(approved.verification_status, "verified");
assert.equal(approved.approval_ref, "synthetic-approval-002");

assert.deepEqual(productCatalogDisplayIdentity(undefined), {
  productName: "未填写产品名称",
  internalSku: "未填写产品编号",
});
assert.deepEqual(productCatalogDisplayIdentity({ internal_sku: "SYN-PARTIAL-001" }), {
  productName: "未填写产品名称",
  internalSku: "SYN-PARTIAL-001",
});

console.log("PASS governed intake reaches every ProductReady specification and commercial field");
