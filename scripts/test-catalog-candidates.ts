import assert from "node:assert/strict";
import type { ProductAgentSource } from "../lib/product/agent";
import {
  discoverCatalogCandidates,
  selectCatalogCandidates,
} from "../lib/product/catalog-candidates";

const source: ProductAgentSource = {
  record_id: "synthetic",
  source_ref: "document:synthetic",
  evidence_refs: ["document:synthetic"],
  source_text: "",
  image_availability: "none",
  image_refs: [],
};
const discover = (source_text: string) => discoverCatalogCandidates({ ...source, source_text });
for (const [label, identifier] of [
  ["编号", "999999XD99999"],
  ["编号", "999999XC99999S"],
  ["Kit No.", "9999 999 999"],
  ["Kit No.", "999 999 9999"],
  ["Part No.", "RYC-SYN001"],
  ["Internal SKU", "999XDC999"],
]) {
  assert.equal(
    discover(`${label}: ${identifier}\nSource: synthetic-only`)[0]?.identifier,
    identifier,
  );
  assert.equal(
    discover(`| ${label} | OE |\n| --- | --- |\n| ${identifier} | RYC-SYN999 |`)[0]?.identifier,
    identifier,
  );
}
for (const text of [
  "999999XD99999",
  "OE: RYC-SYN999",
  "Component No.: RYC-SYN999",
  "Part No.: 9999 999 999",
  "Part No.: 999 999 9999",
  "Kit No.: 9999 999 9999",
  "Kit No.: 9999 999 999\nProduct: brake disc",
  "| OE | Component No. |\n| --- | --- |\n| RYC-SYN001 | 999999XD99999 |",
  "Part No.: RYC-SYN001\nPart No.: RYC-SYN002",
]) {
  assert.equal(discover(text).length, 0, text);
}
const records = discover(
  "<!-- f-trade:pdf-page=1 -->\nPart No.: RYC-SYN999\nSynthetic attribute: A\n\n<!-- f-trade:pdf-page=2 -->\n\n<!-- f-trade:pdf-page=3 -->\nPart No.: RYC-SYN999\nSynthetic attribute: B",
);
assert.equal(records.length, 2);
assert.notEqual(records[0]!.record_id, records[1]!.record_id);
assert.notEqual(records[0]!.source.evidence_refs[0], records[1]!.source.evidence_refs[0]);
assert.match(records[1]!.source.evidence_refs[0]!, /pdf-page=3/);
assert.ok(
  records.every((record) => record.review_status === "duplicate_identifier_review_required"),
);
assert.equal(selectCatalogCandidates(records, new Set(["RYC-SYN999"]), Infinity).length, 2);
assert.equal(selectCatalogCandidates(records, new Set(["RYC-SYN999"]), 1).length, 1);
assert.throws(
  () => selectCatalogCandidates(records, new Set(["RYC-SYN999", "missing"]), 1),
  /not found/,
);
assert.equal(discover("Part No.: RYC-SYN999\n\nPart No.: RYC-SYN999").length, 2);
console.log("PASS synthetic catalog identifier, duplicate and location regressions");

const spatialKit = discover(
  "<!-- f-trade:pdf-page=2 -->\nOriginal OCR (unverified):\n> Kit No.: 9999 999 990\n> Part No.: SYN-COMP\n\nKit No.: 9999 999 990\nComponent 1 source [ocr-pixels=100,70,210,120]: Part No.: SYN-COMP / Type No.: MOCK-TYPE / Size: 1*2",
);
assert.equal(spatialKit.length, 1);
assert.match(spatialKit[0]!.source.source_text, /Component 1 source/);
assert.match(spatialKit[0]!.source.source_text, /Size: 1\*2/);
assert.match(spatialKit[0]!.source.evidence_refs[0]!, /pdf-page=2/);

const labelsOnly = discover(
  "<!-- f-trade:pdf-page=4 -->\nOriginal OCR (unverified):\n> Kit No.: 999 999 9999\n> Part No.: SYN-UNOWNED\n\nKit No.: 999 999 9999\nSource kit label (unverified OCR); component associations were not recovered.",
);
assert.equal(labelsOnly.length, 1);
assert.equal(labelsOnly[0]?.identifier, "999 999 9999");
assert.equal(labelsOnly[0]?.review_status, "source_review_required");
assert.ok(!labelsOnly[0]?.source.source_text.includes("Part No."));
assert.match(labelsOnly[0]?.source.evidence_refs[0] ?? "", /pdf-page=4/);
