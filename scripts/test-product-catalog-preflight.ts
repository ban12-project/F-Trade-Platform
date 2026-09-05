import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverCatalogCandidates } from "../lib/product/catalog-candidates";
import type { ProductAgentDocumentSource } from "../lib/product/document-source";
import {
  type CatalogResult,
  completeCatalogBatch,
  createCatalogPreflightReport,
  writeCatalogReportSnapshot,
} from "./run-product-agent-catalog";

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
  layout_recovered_pages: [],
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
    layout_recovered_pages: [],
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

const layoutReport = createCatalogPreflightReport(
  { ...document, layout_recovered_pages: [2] },
  discoverCatalogCandidates(document.source),
);
assert.deepEqual(layoutReport.document.layout_recovered_pages, [2]);
assert.ok(
  layoutReport.manual_review.reasons.includes("layout_recovery_requires_visual_verification"),
);

async function verifyBatchFailures() {
  function records(): CatalogResult[] {
    return [0, 1, 2].map((index) => ({
      identifier: `RYC-SYN-${index}`,
      record_id: `synthetic-record-${index}`,
      review_status: "source_review_required",
      evidence_ref: `synthetic-evidence-${index}`,
      status: "pending",
    }));
  }
  for (const failedIndices of [new Set<number>(), new Set([0]), new Set([0, 1, 2])]) {
    const results = records();
    const attempted: number[] = [];
    const reports: CatalogResult[][] = [];
    const run = completeCatalogBatch(
      results,
      2,
      async (index) => {
        attempted.push(index);
        if (failedIndices.has(index)) throw new Error("synthetic extraction failure");
        return { draft: { synthetic: true }, evidence_locations: [] };
      },
      async () => {
        reports.push(structuredClone(results));
      },
    );
    if (failedIndices.size) {
      await assert.rejects(run, new RegExp(`${failedIndices.size} failed, 0 pending`));
    } else await run;
    assert.deepEqual(attempted.toSorted(), [0, 1, 2]);
    assert.ok(reports[0]?.every((record) => record.status === "pending"));
    const final = reports.at(-1)!;
    assert.equal(final.filter((record) => record.status === "failed").length, failedIndices.size);
    assert.ok(final.every((record) => record.status !== "pending"));
    assert.ok(
      final.filter((record) => record.status === "succeeded").every((record) => record.draft),
    );
  }
  let called = false;
  await assert.rejects(
    completeCatalogBatch(
      records(),
      1,
      async () => {
        called = true;
        return {};
      },
      async () => {
        throw new Error("synthetic report write failure");
      },
    ),
    /report write failure/,
  );
  assert.equal(called, false, "initial report must be persisted before extraction starts");
  console.log(
    "PASS catalog batches preserve all outcomes and reject partial/all extraction failure",
  );
}
void verifyBatchFailures();

async function verifyReportHistory() {
  const directory = await mkdtemp(join(tmpdir(), "f-trade-catalog-history-"));
  try {
    const reportPath = join(directory, "run.json");
    const attempts = await Promise.allSettled([
      writeCatalogReportSnapshot(reportPath, "first", true),
      writeCatalogReportSnapshot(reportPath, "second", true),
    ]);
    assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
    const failure = attempts.find((item) => item.status === "rejected");
    assert.ok(failure?.status === "rejected");
    assert.match(String(failure.reason), /choose a new --output/);
    const previous = await readFile(reportPath, "utf8");
    await assert.rejects(
      writeCatalogReportSnapshot(reportPath, "replacement", true),
      /already exists/,
    );
    assert.equal(await readFile(reportPath, "utf8"), previous);
    await writeCatalogReportSnapshot(reportPath, "completed", false);
    assert.equal(await readFile(reportPath, "utf8"), "completed");
    assert.deepEqual(await readdir(directory), ["run.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(
    "PASS new catalog runs cannot overwrite earlier reports, including concurrent starts",
  );
}
void verifyReportHistory();
