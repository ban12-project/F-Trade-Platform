import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "f-trade-pdf-preflight-"));
try {
  const path = join(directory, "synthetic-table.pdf");
  execFileSync(process.env.MARKITDOWN_PYTHON ?? "python3", [
    "-c",
    `
import sys
from pathlib import Path
sys.path.insert(0, 'scripts')
from synthetic_pdf_fixture import build_pdf, text_command
commands = b''.join(text_command(value, x, y) for y, values in [
    (550, ['Part No.', 'OEM No.', 'Fit Model']),
    (440, ['RYC-SYN001', 'SYN-OE-A', 'Synthetic A']),
    (340, ['RYC-SYN001', 'SYN-OE-B', 'Synthetic B']),
] for x, value in zip((30, 230, 430), values))
Path(sys.argv[1]).write_bytes(build_pdf([commands]))
`,
    path,
  ]);
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/run-product-agent-catalog.ts",
      "--document",
      path,
      "--preflight",
      "--identifiers",
      "RYC-SYN001",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL: "0",
        PRODUCT_DOCUMENT_SANDBOX_IMAGE: "",
        MARKITDOWN_OCR_ENABLED: "0",
        F_TRADE_LOCAL_OCR_ENABLED: "0",
      },
    },
  );
  const report = JSON.parse(output);
  assert.equal(report.candidate_count, 2);
  assert.deepEqual(report.document.layout_recovered_pages, [1]);
  assert.ok(report.manual_review.reasons.includes("layout_recovery_requires_visual_verification"));
  assert.notEqual(report.candidate_records[0].record_id, report.candidate_records[1].record_id);
  for (const record of report.candidate_records) {
    assert.equal(record.review_status, "duplicate_identifier_review_required");
    assert.match(record.evidence_ref, /#pdf-page=1&record-line=/);
  }
  assert.equal(output.includes("SYN-OE-A"), false);
  assert.equal(output.includes("source_text"), false);
  console.log("PASS actual PDF → layout recovery → duplicate candidates → CLI review report");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
