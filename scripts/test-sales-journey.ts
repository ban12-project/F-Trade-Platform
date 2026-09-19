import assert from "node:assert/strict";
import { type SalesRelationRecord, salesRelations } from "../lib/sales/journey";

const record = (
  kind: SalesRelationRecord["kind"],
  id: string,
  links: Partial<SalesRelationRecord> = {},
): SalesRelationRecord => ({ kind, id, state: "SYNTHETIC", title: `MOCK ${id}`, ...links });
const records = [
  record("lead", "lead-a", { rfqId: "rfq-a", quotationId: "quote-a", deliveryId: "delivery-a" }),
  record("lead", "lead-b", { rfqId: "rfq-b", quotationId: "quote-b" }),
  record("rfq", "rfq-a", { leadId: "lead-a" }),
  record("rfq", "rfq-b", { leadId: "lead-b" }),
  record("quotation", "quote-a", { rfqId: "rfq-a" }),
  record("quotation", "quote-b", { rfqId: "rfq-b" }),
  record("delivery", "delivery-a", { rfqId: "rfq-a" }),
];
assert.deepEqual(
  salesRelations(records, "lead", "lead-a")?.related.map((r) => r.id),
  ["rfq-a", "quote-a", "delivery-a"],
);
assert.deepEqual(
  salesRelations(records, "quotation", "quote-a")?.related.map((r) => r.id),
  ["lead-a", "rfq-a", "delivery-a"],
);
assert.deepEqual(
  salesRelations(records, "delivery", "delivery-a")?.related.map((r) => r.id),
  ["lead-a", "rfq-a", "quote-a"],
);
assert.equal(salesRelations(records, "lead", "unknown"), null);

// A stale or corrupt forward link must not override the RFQ's explicit inbound lead.
const conflicted = records.map((r) => (r.id === "lead-b" ? { ...r, rfqId: "rfq-a" } : r));
assert.deepEqual(
  salesRelations(conflicted, "lead", "lead-b")?.related.map((r) => r.id),
  ["rfq-b", "quote-b"],
);
assert.equal(salesRelations(conflicted, "lead", "lead-b")?.missingContext, true);
assert(!salesRelations(conflicted, "quotation", "quote-a")?.related.some((r) => r.id === "lead-b"));

// A payload referring to an unavailable object must neither invent a link nor substitute a sibling.
const unavailable = records.map((r) =>
  r.id === "quote-a" ? { ...r, rfqId: "outside-project" } : r,
);
assert.deepEqual(salesRelations(unavailable, "quotation", "quote-a")?.related, []);
assert.equal(salesRelations(unavailable, "quotation", "quote-a")?.missingContext, true);

// A manually collected RFQ gets its customer context from the post-send lead's explicit back-reference.
const manual = records.map((r) => (r.id === "rfq-a" ? { ...r, leadId: undefined } : r));
assert(salesRelations(manual, "rfq", "rfq-a")?.related.some((r) => r.id === "lead-a"));

// Multiple quotes remain visible; the read model must not silently pick one as the customer's quote.
const multiple = [...records, record("quotation", "quote-a2", { rfqId: "rfq-a" })];
assert.equal(
  salesRelations(multiple, "rfq", "rfq-a")?.related.filter((r) => r.kind === "quotation").length,
  2,
);
console.log(
  "Synthetic customer relationships: isolation, missing parents and multiple quotes passed.",
);
