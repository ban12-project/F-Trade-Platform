import assert from "node:assert/strict";

import {
  finalizeProductAgentDraft,
  type ProductAgent,
  type ProductAgentSource,
} from "../lib/product/agent";
import { EvidenceLocatedProductAgent } from "../lib/product/evidence-located-agent";
import {
  assertProductAgentEvidenceLocations,
  buildProductAgentEvidenceLocations,
  compactProductAgentEvidenceRefs,
  prepareProductAgentEvidenceSource,
  type ProductAgentEvidenceLocatedSource,
} from "../lib/product/evidence-locations";
import type { ProductDraft } from "../lib/product/verification";

const source: ProductAgentSource = {
  record_id: "synthetic-evidence-product-001",
  source_ref: "source-evidence-locations-001",
  evidence_refs: ["evidence-document-001"],
  source_text: [
    "Confidential factory catalog extract.",
    "Product name: Synthetic Clutch Kit",
    "Product type: clutch_kit",
    "Internal SKU: SYN-KIT-001",
    "OEM No.: OE-001, OE-002",
    "MOQ: 50",
    "Unlabelled marketing narrative must not become evidence.",
  ].join("\n"),
  image_availability: "none",
  image_refs: [],
};

function locationContaining(
  prepared: ProductAgentEvidenceLocatedSource,
  text: string,
) {
  const location = prepared.evidence_locations.find((candidate) => candidate.text.includes(text));
  assert.ok(location, `Missing evidence location containing ${text}`);
  return location;
}

const firstLocations = buildProductAgentEvidenceLocations(source.evidence_refs[0]!, source.source_text);
const secondLocations = buildProductAgentEvidenceLocations(source.evidence_refs[0]!, source.source_text);
assert.deepEqual(firstLocations, secondLocations, "Evidence location refs must be deterministic");
assert.equal(firstLocations.length, 5);
assert.deepEqual(firstLocations.map((location) => location.start_line), [2, 3, 4, 5, 6]);
assert.equal(firstLocations.every((location) => location.kind === "line"), true);
assert.equal(firstLocations.every((location) => location.ref.startsWith("evidence-document-001#loc=line-")), true);
assert.equal(firstLocations.some((location) => location.text.includes("marketing narrative")), false);

const prepared = prepareProductAgentEvidenceSource(source);
assert.equal(prepared.record_id, source.record_id);
assert.equal(prepared.source_ref, source.source_ref);
assert.equal(prepared.image_availability, "none");
assert.deepEqual(prepared.image_refs, []);
assert.deepEqual(prepared.evidence_refs, prepared.evidence_locations.map((location) => location.ref));
assert.match(prepared.source_text, /<evidence-location ref=/);
assert.match(prepared.source_text, /lines="2-2"/);
assert.doesNotMatch(prepared.source_text, /marketing narrative/);

const productNameRef = locationContaining(prepared, "Product name:").ref;
const productTypeRef = locationContaining(prepared, "Product type:").ref;
const skuRef = locationContaining(prepared, "Internal SKU:").ref;
const oeRef = locationContaining(prepared, "OEM No.:").ref;
const moqRef = locationContaining(prepared, "MOQ:").ref;

const locatedDraftInput = {
  record_id: prepared.record_id,
  source_ref: prepared.source_ref,
  evidence_refs: prepared.evidence_refs,
  field_evidence: {
    "product.product_name": productNameRef,
    "product.product_type": productTypeRef,
    "product.internal_sku": skuRef,
    "product.oe_numbers": oeRef,
    "commercial.moq": moqRef,
  },
  verification_status: "review_required",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Synthetic Clutch Kit",
    product_type: "clutch_kit",
    internal_sku: "SYN-KIT-001",
    oe_numbers: ["OE-001", "OE-002"],
  },
  commercial: { moq: 50 },
};
const locatedDraft = finalizeProductAgentDraft(locatedDraftInput, prepared);
assertProductAgentEvidenceLocations(locatedDraft, prepared, finalizeProductAgentDraft);
const compacted = compactProductAgentEvidenceRefs(locatedDraft);
assert.deepEqual(compacted.evidence_refs, [productNameRef, productTypeRef, skuRef, oeRef, moqRef]);

const wrongLocationDraft: ProductDraft = {
  ...locatedDraft,
  field_evidence: {
    ...locatedDraft.field_evidence,
    "product.product_name": skuRef,
  },
};
assert.throws(
  () => assertProductAgentEvidenceLocations(wrongLocationDraft, prepared, finalizeProductAgentDraft),
  /product\.product_name must match an explicitly labelled source value/,
);
assert.throws(
  () => assertProductAgentEvidenceLocations({
    ...locatedDraft,
    field_evidence: {
      ...locatedDraft.field_evidence,
      "product.product_name": "evidence-document-001#loc=unknown",
    },
  }, prepared, finalizeProductAgentDraft),
  /cites an unknown evidence location/,
);

const tableSource: ProductAgentSource = {
  ...source,
  record_id: "synthetic-table-product-001",
  source_text: [
    "| Product name | Product type | Internal SKU | OEM No. | MOQ |",
    "| --- | --- | --- | --- | --- |",
    "| Synthetic Kit 251 | clutch_kit | RYC251 | OE-251 | 25 |",
    "| Synthetic Kit 302 | clutch_kit | RYC302 | OE-302 | 30 |",
  ].join("\n"),
  candidate_identifier: "RYC251",
};
const tablePrepared = prepareProductAgentEvidenceSource(tableSource);
assert.equal(tablePrepared.evidence_locations.length, 2);
assert.deepEqual(tablePrepared.evidence_locations.map((location) => location.start_line), [3, 4]);
for (const location of tablePrepared.evidence_locations) {
  assert.equal(location.kind, "table_row");
  assert.match(location.text, /\| --- \| --- \| --- \| --- \| --- \|/);
  assert.equal(location.text.split("\n").length, 3);
}
assert.match(tablePrepared.evidence_locations[0]!.text, /RYC251/);
assert.doesNotMatch(tablePrepared.evidence_locations[0]!.text, /RYC302/);
assert.match(tablePrepared.evidence_locations[1]!.text, /RYC302/);
assert.doesNotMatch(tablePrepared.evidence_locations[1]!.text, /RYC251/);

const row251Ref = tablePrepared.evidence_locations[0]!.ref;
const row302Ref = tablePrepared.evidence_locations[1]!.ref;
const row251Draft = finalizeProductAgentDraft({
  record_id: tablePrepared.record_id,
  source_ref: tablePrepared.source_ref,
  evidence_refs: tablePrepared.evidence_refs,
  field_evidence: {
    "product.product_name": row251Ref,
    "product.product_type": row251Ref,
    "product.internal_sku": row251Ref,
    "product.oe_numbers": row251Ref,
    "commercial.moq": row251Ref,
  },
  verification_status: "review_required",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Synthetic Kit 251",
    product_type: "clutch_kit",
    internal_sku: "RYC251",
    oe_numbers: ["OE-251"],
  },
  commercial: { moq: 25 },
}, tablePrepared);
assertProductAgentEvidenceLocations(row251Draft, tablePrepared, finalizeProductAgentDraft);
assert.throws(
  () => assertProductAgentEvidenceLocations({
    ...row251Draft,
    field_evidence: {
      ...row251Draft.field_evidence,
      "product.product_name": row302Ref,
    },
  }, tablePrepared, finalizeProductAgentDraft),
  /product\.product_name must match an explicitly labelled source value/,
);

assert.throws(
  () => buildProductAgentEvidenceLocations("evidence-document-001", "General clutch catalog narrative only."),
  /no explicitly labelled evidence locations/,
);
assert.throws(
  () => buildProductAgentEvidenceLocations(
    "evidence-document-001",
    Array.from({ length: 513 }, (_, index) => `MOQ: ${index + 1}`).join("\n"),
  ),
  /more than 512 labelled evidence locations/,
);

const delegate: ProductAgent = {
  async run({ source: locatedSource }) {
    const sourceWithLocations = locatedSource as ProductAgentSource & ProductAgentEvidenceLocatedSource;
    const name = locationContaining(sourceWithLocations, "Product name:").ref;
    const type = locationContaining(sourceWithLocations, "Product type:").ref;
    const sku = locationContaining(sourceWithLocations, "Internal SKU:").ref;
    return {
      draft: finalizeProductAgentDraft({
        record_id: locatedSource.record_id,
        source_ref: locatedSource.source_ref,
        evidence_refs: locatedSource.evidence_refs,
        field_evidence: {
          "product.product_name": name,
          "product.product_type": type,
          "product.internal_sku": sku,
        },
        verification_status: "review_required",
        blocking_missing_fields: [],
        optional_missing_fields: [],
        product: {
          product_name: "Synthetic Clutch Kit",
          product_type: "clutch_kit",
          internal_sku: "SYN-KIT-001",
        },
      }, locatedSource),
      metadata: { prompt_version: "synthetic", prompt_hash: "synthetic" },
    };
  },
};

new EvidenceLocatedProductAgent(delegate).run({
  model: {} as never,
  source,
}).then((wrappedResult) => {
  assert.deepEqual(wrappedResult.draft.evidence_refs, [productNameRef, productTypeRef, skuRef]);
  assert.equal(wrappedResult.metadata.prompt_version, "synthetic");
  console.log("PASS Product Agent facts cite deterministic, bounded line or table-row evidence");
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
