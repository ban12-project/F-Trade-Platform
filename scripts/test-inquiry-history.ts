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
const brandOnly = summarizeInquiryMessages(messages("Need clutch kits for Toyota, 500 pcs"));
assert.equal(brandOnly.fields.vehicleBrand, "Toyota");
assert.equal(brandOnly.fields.vehicleModel, undefined);
assert.deepEqual(brandOnly.conflicts, []);
assert.equal(brandOnly.fields.productType, "clutch_kit");
assert.deepEqual(brandOnly.fieldSources.productType, ["synthetic-0"]);
for (const body of [
  "clutch discs",
  "not clutch kits",
  "clutch discs or covers",
  "clutch kit and release bearing",
]) {
  const result = summarizeInquiryMessages(messages("clutch kits", body));
  assert.equal(result.fields.productType, undefined);
  assert(result.conflicts.includes("productType"));
}
const laterModel = summarizeInquiryMessages(
  messages("500 pcs Toyota clutch kit", "Toyota Corolla clutch kit"),
);
assert.equal(laterModel.fields.vehicleModel, "Corolla");
assert.deepEqual(laterModel.fieldSources.vehicleBrand, ["synthetic-0", "synthetic-1"]);
assert.deepEqual(laterModel.conflicts, []);
for (const reply of ["Honda", "Toyota or Honda", "Not Toyota"]) {
  const changedBrand = summarizeInquiryMessages(messages("Toyota Corolla clutch kit", reply));
  assert.equal(changedBrand.fields.vehicleBrand, undefined);
  assert.equal(changedBrand.fields.vehicleModel, undefined);
  assert(changedBrand.conflicts.includes("vehicleBrand"));
  assert(changedBrand.conflicts.includes("vehicleModel"));
}
for (const alternative of [
  "Toyota Corolla or Camry clutch kit",
  "Toyota Corolla/Camry clutch kit",
  "Toyota Corolla & Camry clutch kit",
]) {
  const modelAlternative = summarizeInquiryMessages(
    messages("Toyota Corolla clutch kit", alternative),
  );
  assert.equal(modelAlternative.fields.vehicleBrand, "Toyota");
  assert.equal(modelAlternative.fields.vehicleModel, undefined);
  assert(modelAlternative.conflicts.includes("vehicleModel"));
}
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
