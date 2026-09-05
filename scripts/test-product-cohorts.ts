import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approveProductDraft,
  type ProductApproval,
  rejectProductDraft,
  reviewProductDraft,
} from "../lib/product/verification";

const matrix = JSON.parse(readFileSync("data/fixtures/product-cohort.synthetic.json", "utf8"));
assert.deepEqual(
  matrix.cohorts.map((cohort: { cohort_id: string }) => cohort.cohort_id),
  ["A", "B", "C", "D"],
);
const results = [];
for (const cohort of matrix.cohorts) {
  const input = JSON.parse(readFileSync(cohort.product_fixture, "utf8"));
  const original = structuredClone(input);
  const review = reviewProductDraft(input);
  assert.deepEqual(review.blocking_missing_fields, cohort.expected_blocking_fields);
  const approval: ProductApproval = {
    approval_id: `mock-cohort-${cohort.cohort_id}-approval`,
    gate: "gate_01_truth",
    entity_type: "product",
    entity_id: input.record_id,
    status: "approved",
    decision: {
      actor_type: "human",
      decided_by: "MOCK simulated reviewer",
      decided_at: new Date().toISOString(),
      evidence_ref: `mock-cohort-${cohort.cohort_id}-decision`,
      notes: "MOCK test decision only; no real human or factory confirmation.",
    },
  };
  // C/D have full application identity: explicit simulated approval can accept it without OE.
  const ready = approveProductDraft(review, approval);
  assert.equal(ready.verification_status, "verified");
  assert.deepEqual(ready.product, input.product);
  const rejected = rejectProductDraft(review, { ...approval, status: "rejected" });
  assert.equal(rejected.verification_status, "revision_required");
  const revised = structuredClone(rejected);
  revised.product.oe_numbers = [`MOCK-COHORT-${cohort.cohort_id}-OE`];
  const mockRef = `mock-cohort-${cohort.cohort_id}-supplement`;
  revised.evidence_refs.push(mockRef);
  revised.field_evidence["product.oe_numbers"] = mockRef;
  assert.deepEqual(reviewProductDraft(revised).blocking_missing_fields, []);
  assert.equal(
    approveProductDraft(reviewProductDraft(revised), approval).verification_status,
    "verified",
  );
  const modelOnly = structuredClone(review);
  delete modelOnly.product.oe_numbers;
  delete modelOnly.product.application;
  delete modelOnly.product.vehicle_brand;
  assert.throws(
    () => approveProductDraft(modelOnly, approval),
    /oe_numbers_or_verified_application/,
  );
  const missingEvidence = structuredClone(revised);
  delete missingEvidence.field_evidence["product.oe_numbers"];
  assert.throws(
    () => approveProductDraft(missingEvidence, approval),
    /field_evidence.product.oe_numbers/,
  );
  assert.deepEqual(input, original);
  results.push({
    cohort: cohort.cohort_id,
    image_group: cohort.image_availability,
    approved: true,
    rejected_then_mock_revised_and_approved: true,
    model_only_blocked: true,
    missing_field_evidence_blocked: true,
  });
}
const summary = {
  classification: "synthetic",
  layer: "local_domain_functions",
  real_image_validation: false,
  real_human_approval: false,
  external_upload: false,
  executed_at: new Date().toISOString(),
  results,
};
console.log(JSON.stringify(summary, null, 2));
