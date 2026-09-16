import assert from "node:assert/strict";
import { finalizeProductAgentDraft } from "../lib/product/agent";
import { preserveCatalogDraftIdentity } from "../lib/product/catalog-draft-identity";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";

const source = prepareProductAgentEvidenceSource({
  record_id: "synthetic-record",
  source_ref: "synthetic",
  evidence_refs: ["synthetic-original#pdf-page=3&record-line=8"],
  source_text: "Kit No.: RYC-MOCK42\nOE No.: MOCK-OE42",
  image_availability: "none",
  image_refs: [],
  candidate_identifier: "RYC-MOCK42",
});
const empty = finalizeProductAgentDraft(
  {
    record_id: source.record_id,
    source_ref: source.source_ref,
    evidence_refs: source.evidence_refs,
    product: {},
    field_evidence: {},
    verification_status: "review_required",
    blocking_missing_fields: [],
    optional_missing_fields: [],
  },
  source,
);
const kept = preserveCatalogDraftIdentity(empty, source, "RYC-MOCK42");
assert.equal(kept.preserved, true);
const validated = finalizeProductAgentDraft(kept.draft, source);
assert.deepEqual(validated.product, { internal_sku: "RYC-MOCK42" });
assert.equal(validated.verification_status, "review_required");
assert.ok(validated.blocking_missing_fields.includes("product.product_name"));
assert.match(validated.field_evidence["product.internal_sku"] ?? "", /page-3/);
assert.throws(
  () => preserveCatalogDraftIdentity(empty, source, "RYC-INVENTED"),
  /labelled evidence/,
);
assert.throws(() => preserveCatalogDraftIdentity(empty, source, "MOCK-OE42"), /labelled evidence/);
const wrong = { ...empty, product: { internal_sku: "RYC-WRONG" } };
assert.equal(
  preserveCatalogDraftIdentity(wrong, source, "RYC-MOCK42").draft,
  wrong,
  "never silently replace conflicting model output",
);
console.log(
  "PASS: empty extraction retains only its independently validated catalog identifier, original page evidence and missing-field review",
);
