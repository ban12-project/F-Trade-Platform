import assert from "node:assert/strict";
import { summarizeInquiryMessages } from "../lib/sales/inquiry-history";

const messages = (...bodies: string[]) =>
  bodies.map((body, i) => ({ id: `synthetic-${i}`, body, receivedAt: new Date(i).toISOString() }));
const combined = summarizeInquiryMessages(
  messages("OE: SYN-123", "500 pcs", "Destination: Synthetic Port."),
);
assert.deepEqual(combined.fields, {
  oeNumber: "SYN-123",
  quantity: "500",
  destination: "Synthetic Port",
});
assert.deepEqual(combined.fieldSources.quantity, ["synthetic-1"]);
assert.deepEqual(combined.conflicts, []);
const repeat = summarizeInquiryMessages(messages("OE: SYN-123", "OE: syn-123"));
assert.equal(repeat.fields.oeNumber, "SYN-123");
assert.deepEqual(repeat.fieldSources.oeNumber, ["synthetic-0", "synthetic-1"]);
const conflict = summarizeInquiryMessages(messages("500 pcs", "600 pcs"));
assert.deepEqual(conflict.fields, {});
assert.deepEqual(conflict.conflicts, ["quantity"]);
for (const ambiguous of ["500 or 600 pcs", "500-600 pcs", "not 500 pcs", "500 pcs and 600 pcs"]) {
  const result = summarizeInquiryMessages(messages("500 pcs", ambiguous));
  assert.equal(result.fields.quantity, undefined);
  assert(result.conflicts.includes("quantity"));
}
const revised = summarizeInquiryMessages(messages("OE: SYN-123", "Ignore OE: SYN-123"));
assert.equal(revised.fields.oeNumber, undefined);
assert(revised.conflicts.includes("oeNumber"));
assert.deepEqual(summarizeInquiryMessages(messages("USD 10, delivery in 5 days")).fields, {});
assert.deepEqual(summarizeInquiryMessages([]), { fields: {}, fieldSources: {}, conflicts: [] });
console.log(
  "PASS multi-message inquiry requirements, provenance, repeated values and manual conflict handling",
);
