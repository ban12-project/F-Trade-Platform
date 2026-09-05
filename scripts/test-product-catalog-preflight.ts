import assert from "node:assert/strict";

import { discoverCatalogCandidates } from "../lib/product/catalog-candidates";
import type { ProductAgentDocumentSource } from "../lib/product/document-source";
import { createCatalogPreflightReport } from "./run-product-agent-catalog";

const document: ProductAgentDocumentSource = {
  source: {
    record_id: "synthetic-catalog",
    source_ref: "document:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    evidence_refs: ["document:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
    source_text: ["| Kit No. | Product name |", "| --- | --- |", "| RYC251 | Synthetic Kit |"].join(
      "\n",
    ),
    image_availability: "none",
    image_refs: [],
  },
  document_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  filename: "synthetic-catalog.md",
  media_type: "md",
  ocr_enabled: false,
  conversion_status: "converted",
};

const report = createCatalogPreflightReport(document, discoverCatalogCandidates(document.source));

assert.deepEqual(report, {
  classification: "local_preflight",
  document: {
    document_sha256: document.document_sha256,
    filename: "synthetic-catalog.md",
    media_type: "md",
    ocr_enabled: false,
    conversion_status: "converted",
  },
  candidate_count: 1,
  candidate_identifiers: ["RYC251"],
  candidate_records: [
    {
      identifier: "RYC251",
      record_id: "synthetic-catalog-record-3",
      review_status: "source_review_required",
      evidence_ref: `${document.source.source_ref}#record-line=3`,
    },
  ],
  manual_review: {
    status: "review_required",
    reasons: ["catalog_candidates_require_source_field_review"],
  },
});
assert.equal(JSON.stringify(report).includes("Synthetic Kit"), false);
assert.equal(JSON.stringify(report).includes("source_text"), false);

const imageOnlyReport = createCatalogPreflightReport(
  { ...document, ocr_enabled: true, conversion_status: "no_text" },
  [],
);
assert.deepEqual(imageOnlyReport.manual_review, {
  status: "review_required",
  reasons: [
    "catalog_candidates_require_source_field_review",
    "no_supported_catalog_candidates",
    "ocr_text_requires_visual_verification",
    "document_conversion_requires_approved_ocr",
  ],
});

console.log("PASS product catalog preflight");
