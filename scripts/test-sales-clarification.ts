import assert from "node:assert/strict";
import {
  inquirySuggestionFieldsSchema,
  inquirySuggestionRequestSchema,
  rfqFormSchema,
} from "../lib/form-schemas";
import { promoteRfqReady } from "../lib/rfq/completeness";
import {
  applyInquiryMessage,
  assertNoAgentQuotation,
  nextClarification,
} from "../lib/sales/clarification";

const draft = {
  rfq_id: "synthetic-rfq",
  customer: {},
  product: { product_type: "clutch_kit" },
  commercial: {},
  status: "collecting",
  completeness_score: 0,
  missing_fields: [],
};
const partial = applyInquiryMessage(draft, "500 pcs Toyota Corolla clutch kit, please quote");
assert.equal(partial.commercial.quantity, 500);
assert.equal(nextClarification(partial).field, "destination");
for (const body of [
  "Need clutch kits for Toyota, 500 pcs",
  "Hi, 500 pcs Toyota clutch kit, please quote.",
]) {
  const example = applyInquiryMessage({ ...draft, product: {} }, body);
  assert.equal(example.product.product_type, "clutch_kit");
  assert.equal(example.product.vehicle_brand, "Toyota");
  assert.equal(example.product.vehicle_model, undefined);
  assert.equal(example.commercial.quantity, 500);
  assert.equal(nextClarification(example).field, "vehicle_model_or_oe_number");
}
assert.equal(
  applyInquiryMessage(draft, "Toyota Corolla or Camry clutch").product.vehicle_model,
  undefined,
);
const complete = applyInquiryMessage(partial, "Destination: Synthetic Port");
assert.equal(nextClarification(complete).status, "ready");
assert.throws(() => assertNoAgentQuotation(complete), /cannot send/);
for (const message of [
  "500 pcs or 600 pcs",
  "0 pcs",
  "-500 pcs",
  "1,500 pcs",
  "500.5 pcs",
  "999999999999999999 pcs",
  "500 to 600 pcs",
  "500 or 600 pcs",
  "500/600 pcs",
  "500 & 600 pcs",
  "500–600 pcs",
  "500 — 600 pcs",
  "between 500 and 600 pcs",
  "500 pcs or 600",
  "500 pcs to 600",
]) {
  assert.equal(applyInquiryMessage(draft, message).commercial.quantity, undefined, message);
}
for (const message of [
  "OE: SYN-001; OE: SYN-002",
  "OE: SYN-001/SYN-002",
  "OE: SYN-001.2",
  "OE: SYN-001_2",
  "OE: SYN-001+2",
  "OE: SYN-001/SYN-002; OE: SYN-003",
  "Can you quote to me?",
  "Destination: A port; Destination: B port",
  "Toyota Corolla clutch or Honda Civic clutch",
]) {
  const suggestion = applyInquiryMessage(draft, message);
  assert.deepEqual(suggestion.product, draft.product, message);
  assert.deepEqual(suggestion.commercial, {}, message);
}
const explicit = applyInquiryMessage(
  draft,
  "OE: SYN-001; 500 pcs; Destination: Synthetic Port. USD 5, MOQ 30, delivery in 10 days.",
);
assert.deepEqual(explicit.product, { product_type: "clutch_kit", oe_number: "SYN-001" });
assert.deepEqual(explicit.commercial, { quantity: 500, destination: "Synthetic Port" });
for (const message of ["500 pcs", "Please quote 500 pieces", "500 pc; 30 days"]) {
  assert.equal(applyInquiryMessage(draft, message).commercial.quantity, 500, message);
}
for (const message of ["OE: SYN-001;", "OEM # SYN-001, please quote", "OE: SYN-001\n"]) {
  assert.equal(applyInquiryMessage(draft, message).product.oe_number, "SYN-001", message);
}
const existing = {
  ...draft,
  product: { ...draft.product, oe_number: "SYN-MANUAL" },
  commercial: { quantity: 100 },
};
const ambiguous = applyInquiryMessage(existing, "OE: SYN-001/SYN-002; 500 or 600 pcs");
assert.deepEqual(ambiguous.product, existing.product);
assert.deepEqual(ambiguous.commercial, existing.commercial);
const incomplete = applyInquiryMessage(
  draft,
  "OE: SYN-001/SYN-002; 500 to 600 pcs; Destination: Synthetic Port",
);
assert(incomplete.missing_fields.includes("vehicle_model_or_oe_number"));
assert(incomplete.missing_fields.includes("quantity"));
assert.equal(nextClarification(incomplete).status, "clarification_required");
for (const [body, type] of [
  ["500 pcs clutch discs", "clutch_disc"],
  ["clutch disk", "clutch_disc"],
  ["pressure plates", "clutch_cover"],
  ["clutch covers", "clutch_cover"],
  ["release bearing", "release_bearing"],
  ["throw-out bearings", "release_bearing"],
  ["离合器套件", "clutch_kit"],
  ["离合器片", "clutch_disc"],
]) {
  assert.equal(
    applyInquiryMessage({ product: {}, commercial: {} }, body).product.product_type,
    type,
  );
}
for (const body of [
  "clutch",
  "not clutch kits",
  "clutch discs or covers",
  "clutch kit with release bearing",
  "clutch discs/covers",
]) {
  assert.equal(
    applyInquiryMessage({ product: {}, commercial: {} }, body).product.product_type,
    undefined,
  );
}
const unknownType = applyInquiryMessage(
  { product: {}, commercial: {} },
  "OE: SYN-001; 500 pcs; Destination: Synthetic Port",
);
assert.equal(nextClarification(unknownType).field, "product_type");
assert.throws(() => promoteRfqReady(unknownType), /product_type/);
assert(!rfqFormSchema.shape.productType.safeParse("").success);
assert(!rfqFormSchema.shape.productType.safeParse("invented_component").success);
assert(!inquirySuggestionFieldsSchema.safeParse({ unitPrice: "5", leadTimeDays: "10" }).success);
assert(
  !inquirySuggestionRequestSchema.safeParse({
    projectId: "untrusted",
    leadId: "untrusted",
    message: "client body",
  }).success,
);
console.log("PASS Sales clarification behavior");
