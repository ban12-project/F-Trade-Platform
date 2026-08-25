import { productCatalogFormSchema, productReviewFormSchema } from "../lib/form-schemas";
import { approveProductDraft, rejectProductDraft } from "../lib/product/verification";
import { buildProductCatalogDraft } from "../lib/products";
import { assertTransition } from "../lib/workflow/transitions";

const validInput = productCatalogFormSchema.parse({
  productName: "Synthetic clutch disc",
  productType: "clutch_disc",
  internalSku: "SYN-DISC-001",
  oeNumbers: "",
  application: "",
  vehicleBrand: "",
  vehicleModel: "",
  clutchDiameterMm: "240",
  splineCount: "21",
  splineSize: "20 x 18",
  frictionMaterial: "Synthetic material",
  sourceRef: "source-catalog-001",
  evidenceRef: "evidence-product-001",
});

const draft = buildProductCatalogDraft(validInput, "synthetic-product-001");
if (draft.verification_status !== "review_required") {
  throw new Error("Catalog entry must create a review-required draft");
}
if (!draft.blocking_missing_fields.includes("oe_numbers_or_verified_application")) {
  throw new Error("A draft without OE or complete application identity must remain blocked");
}
for (const field of [
  "product.product_name",
  "product.product_type",
  "product.internal_sku",
  "specifications.clutch_diameter_mm",
  "specifications.spline_count",
] as const) {
  if (draft.field_evidence[field] !== "evidence-product-001") {
    throw new Error(`Catalog draft must attach evidence to ${field}`);
  }
}
if (productCatalogFormSchema.safeParse({ ...validInput, sourceRef: "/private/tmp/catalog.pdf" }).success) {
  throw new Error("Catalog entry must reject local file paths as source references");
}
if (productCatalogFormSchema.safeParse({ ...validInput, clutchDiameterMm: "0" }).success) {
  throw new Error("Catalog entry must reject a zero clutch diameter");
}

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
if (productReviewFormSchema.safeParse({ productId: "not-a-uuid", decision: "approved", evidenceRef: "evidence-review-001", notes: "" }).success) {
  throw new Error("Product review must reject an invalid product identifier");
}
if (productReviewFormSchema.safeParse({ productId: "00000000-0000-4000-8000-000000000001", decision: "approved", evidenceRef: "/tmp/review", notes: "" }).success) {
  throw new Error("Product review must reject local paths as evidence references");
}
assertRejectsIncompleteApproval();

function assertRejectsIncompleteApproval() {
  try {
    approveProductDraft(draft, reviewerApproval);
  } catch (error) {
    if (error instanceof Error && /Product cannot be Ready/.test(error.message)) {
      const revision = rejectProductDraft(draft, { ...reviewerApproval, status: "rejected" });
      if (revision.verification_status !== "revision_required") {
        throw new Error("Rejected Gate 01 decision must require revision");
      }
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
      return;
    }
    throw error;
  }
  throw new Error("Incomplete product draft must not become ProductReady");
}

console.log("PASS product catalog entry");
