import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  catalogIntakeSchema,
  catalogLookupSchema,
  catalogSelectionSchema,
} from "../lib/product/catalog-import-contracts";

const identity = { projectId: randomUUID(), importId: randomUUID() };
const selection = {
  ...identity,
  candidateIds: Array.from({ length: 20 }, () => randomUUID()),
  modelConfigId: randomUUID(),
  model: "synthetic-only",
};
assert.deepEqual(catalogSelectionSchema.parse(selection), selection);
for (const candidateIds of [
  [],
  [...selection.candidateIds, randomUUID()],
  [selection.candidateIds[0], selection.candidateIds[0]],
  ["SYNTHETIC-CATALOG-IDENTIFIER"],
]) {
  assert.equal(catalogSelectionSchema.safeParse({ ...selection, candidateIds }).success, false);
}

// A client can choose server-issued identities, but cannot substitute source facts or paths.
for (const untrusted of [
  { sourceText: "Product name: SYNTHETIC INJECTED" },
  { blobPath: "evidence/another-project/source.pdf" },
  { product: { internal_sku: "SYNTHETIC INJECTED" } },
  { actorId: randomUUID() },
  { productId: randomUUID() },
  { status: "completed" },
]) {
  assert.equal(catalogSelectionSchema.safeParse({ ...selection, ...untrusted }).success, false);
}
assert.equal(
  catalogIntakeSchema.safeParse({ projectId: identity.projectId, receiptId: randomUUID() }).success,
  true,
);
assert.equal(
  catalogIntakeSchema.safeParse({ projectId: identity.projectId, blobPath: "synthetic.pdf" })
    .success,
  false,
);
assert.equal(catalogLookupSchema.safeParse({ ...identity, actorId: randomUUID() }).success, false);
console.log(
  "PASS catalog request boundaries reject duplicate selection and client source injection",
);
