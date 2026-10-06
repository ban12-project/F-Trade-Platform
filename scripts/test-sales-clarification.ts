import assert from "node:assert/strict";
import { inquirySuggestionFieldsSchema, inquirySuggestionRequestSchema } from "../lib/form-schemas";
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
]) {
  assert.equal(applyInquiryMessage(draft, message).commercial.quantity, undefined, message);
}
for (const message of [
  "OE: SYN-001; OE: SYN-002",
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
assert(!inquirySuggestionFieldsSchema.safeParse({ unitPrice: "5", leadTimeDays: "10" }).success);
assert(
  !inquirySuggestionRequestSchema.safeParse({
    projectId: "untrusted",
    leadId: "untrusted",
    message: "client body",
  }).success,
);
console.log("PASS Sales clarification behavior");
