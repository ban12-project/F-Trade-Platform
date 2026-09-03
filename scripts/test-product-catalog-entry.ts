import assert from "node:assert/strict";

import { productReviewFormSchema } from "../lib/form-schemas";
import { productCatalogFormSchema } from "../lib/product/catalog-form-schema";
import { buildEvidenceBoundProductCatalogDraft } from "../lib/product/evidence-bound-catalog";
import { approveProductDraft, rejectProductDraft } from "../lib/product/verification";
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
  sourceRef: "source-catalog-001",
  projectId: "00000000-0000-4000-8000-000000000011",
});

const draft = buildEvidenceBoundProductCatalogDraft(validInput, "synthetic-product-001");
assert.equal(draft.verification_status, "review_required");
assert.ok(draft.blocking_missing_fields.includes("oe_numbers_or_verified_application"));
assert.equal(draft.field_evidence["product.product_name"], "evidence-catalog-title-001");
assert.equal(draft.field_evidence["product.product_type"], "evidence-catalog-title-001");
assert.equal(draft.field_evidence["product.internal_sku"], "evidence-catalog-sku-001");
assert.equal(draft.field_evidence["specifications.clutch_diameter_mm"], "evidence-catalog-diameter-001");
assert.equal(draft.field_evidence["specifications.spline_count"], "evidence-catalog-spline-count-001");
assert.equal(draft.field_evidence["specifications.spline_size"], "evidence-catalog-spline-size-001");
assert.equal(draft.field_evidence["specifications.friction_material"], "evidence-catalog-material-001");
assert.deepEqual(draft.evidence_refs, [
  "evidence-catalog-title-001",
  "evidence-catalog-sku-001",
  "evidence-catalog-diameter-001",
  "evidence-catalog-spline-count-001",
  "evidence-catalog-spline-size-001",
  "evidence-catalog-material-001",
]);
assert.equal(Object.values(draft.field_evidence).every((ref) => draft.evidence_refs.includes(ref)), true);

assert.equal(productCatalogFormSchema.safeParse({
  ...validInput,
  sourceRef: "/private/tmp/catalog.pdf",
}).success, false, "Catalog entry must reject local file paths as source references");
assert.equal(productCatalogFormSchema.safeParse({
  ...validInput,
  clutchDiameterMm: "0",
}).success, false, "Catalog entry must reject a zero clutch diameter");
assert.equal(productCatalogFormSchema.safeParse({
  ...validInput,
  clutchDiameterMmEvidenceRef: "",
}).success, false, "A present fact must have its own evidence reference");
assert.equal(productCatalogFormSchema.safeParse({
  ...validInput,
  splineSize: "",
  splineSizeEvidenceRef: "evidence-orphaned-001",
}).success, false, "An absent fact cannot retain an orphaned evidence reference");
assert.equal(productCatalogFormSchema.safeParse({
  ...validInput,
  productNameEvidenceRef: "",
}).success, false, "Core product identity evidence is mandatory");

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
assert.equal(productReviewFormSchema.safeParse({
  productId: "not-a-uuid",
  decision: "approved",
  evidenceRef: "evidence-review-001",
  notes: "",
}).success, false);
assert.equal(productReviewFormSchema.safeParse({
  productId: "00000000-0000-4000-8000-000000000001",
  decision: "approved",
  evidenceRef: "/tmp/review",
  notes: "",
}).success, false);

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

const completeDraft = buildEvidenceBoundProductCatalogDraft({
  ...validInput,
  oeNumbers: "OE-001, OE-002, OE-001",
  oeNumbersEvidenceRef: "evidence-catalog-oe-001",
}, "synthetic-product-002");
assert.deepEqual(completeDraft.product.oe_numbers, ["OE-001", "OE-002"]);
assert.equal(completeDraft.field_evidence["product.oe_numbers"], "evidence-catalog-oe-001");
assert.equal(completeDraft.blocking_missing_fields.includes("oe_numbers_or_verified_application"), false);
const approved = approveProductDraft(completeDraft, {
  ...reviewerApproval,
  approval_id: "synthetic-approval-002",
  entity_id: "synthetic-product-002",
});
assert.equal(approved.verification_status, "verified");
assert.equal(approved.approval_ref, "synthetic-approval-002");

console.log("PASS manual product catalog binds every populated fact to explicit evidence");
