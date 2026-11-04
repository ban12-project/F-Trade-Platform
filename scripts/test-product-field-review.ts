import assert from "node:assert/strict";
import { productFieldSources, productReviewValue } from "../lib/product/field-review";

assert.equal(productReviewValue(false), "否");
assert.equal(productReviewValue(true), "是");
assert.equal(productReviewValue(0), "0");
assert.equal(productReviewValue(null), "");
assert.equal(productReviewValue(["A", "B"]), "A, B");
const fact = { path: "product.product_name", evidence: "saved-ref", value: "SYNTHETIC" };
const source = {
  id: "saved-ref",
  label: "SYNTHETIC",
  href: "/api/product-evidence/synthetic",
  contentType: "text/plain",
  fields: [
    { path: fact.path, reference: "stale-ref", excerpt: "Wrong reference" },
    { path: "product.internal_sku", reference: fact.evidence, excerpt: "Wrong field" },
    { path: fact.path, reference: fact.evidence, excerpt: "Exact match" },
  ],
};
assert.deepEqual(productFieldSources([source], fact)[0].fields, [source.fields[2]]);
assert.equal(source.fields.length, 3, "Do not mutate authorized previews");
assert.deepEqual(productFieldSources([{ ...source, fields: source.fields.slice(0, 2) }], fact), []);
assert.deepEqual(productFieldSources([source], { ...fact, evidence: "" }), []);
assert.deepEqual(productFieldSources([], fact), []);
console.log("Product field review matching and value checks passed.");
