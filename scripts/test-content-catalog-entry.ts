import { assertContentVisualInstruction, buildContentDraft } from "../lib/content/store";
import { contentDraftFormSchema, contentReviewFormSchema } from "../lib/form-schemas";
import type { ProductReady } from "../lib/product/verification";
import { assertTransition } from "../lib/workflow/transitions";

const productId = "00000000-0000-4000-8000-000000000001";
const validReview = {
  contentId: productId,
  reviewedVersion: "3",
  approvalId: "00000000-0000-4000-8000-000000000003",
  decision: "approved",
  evidenceRef: "evidence-review-001",
  notes: "",
};
if (!contentReviewFormSchema.safeParse(validReview).success)
  throw new Error("Version-bound content review must accept a valid request");
for (const patch of [
  { reviewedVersion: undefined },
  { reviewedVersion: "0" },
  { reviewedVersion: "01" },
  { reviewedVersion: "1e3" },
  { reviewedVersion: "9007199254740992" },
  { approvalId: undefined },
  { approvalId: "invalid" },
]) {
  if (contentReviewFormSchema.safeParse({ ...validReview, ...patch }).success)
    throw new Error("Content review must reject missing or invalid version/approval identity");
}
const input = contentDraftFormSchema.parse({
  productId,
  contentType: "product",
  factPath: "product.product_type",
  objective: "Synthetic content workflow test",
  targetCustomer: "Synthetic distributor",
  hook: "Synthetic post only",
  body: "This copy is synthetic and must be reviewed before publication.",
  callToAction: "Share application details for human review.",
  hashtags: "#SyntheticDemo, #Clutch",
  visualInstruction:
    "Use a clearly labelled synthetic product mockup without engineering callouts.",
});
const product: ProductReady = {
  record_id: productId,
  source_ref: "source-product-001",
  evidence_refs: ["evidence-product-001", "evidence-review-001"],
  field_evidence: {
    "product.product_name": "evidence-product-001",
    "product.product_type": "evidence-product-001",
    "product.internal_sku": "evidence-product-001",
    "product.oe_numbers": "evidence-product-001",
  },
  verification_status: "verified",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Synthetic clutch",
    product_type: "clutch_disc",
    internal_sku: "SYN-001",
    oe_numbers: ["SYN-OE-001"],
  },
  approval_ref: "synthetic-approval-001",
};
const content = buildContentDraft(input, product, "00000000-0000-4000-8000-000000000002");
if (
  content.status !== "review_required" ||
  content.product_facts[1]?.value !== "clutch_disc" ||
  content.product_facts[1]?.evidence_ref !== "evidence-product-001" ||
  content.product_facts[0]?.field !== "product.product_name"
) {
  throw new Error("Content draft must derive its product fact and evidence from ProductReady");
}
if (
  contentReviewFormSchema.safeParse({
    contentId: "invalid",
    decision: "approved",
    evidenceRef: "evidence-review-001",
    notes: "",
  }).success
) {
  throw new Error("Content review must reject invalid identifiers");
}
try {
  assertContentVisualInstruction("Show the exact spline geometry in the visual.");
  throw new Error("Content visual instructions must reject engineering claims");
} catch (error) {
  if (!(error instanceof Error) || !/工程事实/.test(error.message)) throw error;
}
assertTransition({
  eventId: "synthetic-content-revision-event-001",
  entityType: "content",
  entityId: "00000000-0000-4000-8000-000000000002",
  fromState: "CONTENT_REVISION_REQUIRED",
  toState: "CONTENT_REVIEW_REQUIRED",
  actorType: "human",
  actorId: "synthetic-editor",
  occurredAt: "2026-08-25T00:01:00Z",
  evidenceRefs: ["evidence-product-001"],
});
console.log("PASS content catalog entry");
