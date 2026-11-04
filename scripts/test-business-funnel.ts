import assert from "node:assert/strict";
import { deriveBusinessFunnel } from "../lib/workspace/business-funnel";
import { syntheticFunnelSnapshot } from "../tests/fixtures/business-funnel/snapshot";

const derive = (
  snapshot = syntheticFunnelSnapshot(),
  confirmed: string[] | null = ["synthetic-opportunity"],
) => deriveBusinessFunnel(snapshot, confirmed);
const counts = (snapshot = syntheticFunnelSnapshot(), confirmed?: string[] | null) =>
  derive(snapshot, confirmed).stages.map((s) => s.count);
assert.deepEqual(counts(), [1, 1, 1, 1, 1]);
assert.deepEqual(counts({ ...syntheticFunnelSnapshot(), projects: [] }), [0, 0, 0, 0, 0]);
assert.deepEqual(
  counts({
    ...syntheticFunnelSnapshot(),
    projects: syntheticFunnelSnapshot().projects.map((p) => ({ ...p, status: "archived" })),
  }),
  [0, 0, 0, 0, 0],
);
assert.deepEqual(
  counts({
    ...syntheticFunnelSnapshot(),
    records: syntheticFunnelSnapshot().records.map((r) => ({ ...r, relation: "reference" })),
  }),
  [0, 0, 0, 0, 0],
);
const duplicated = syntheticFunnelSnapshot();
duplicated.records.push(...duplicated.records);
duplicated.publications.push({ ...duplicated.publications[0], id: "another-account" });
assert.deepEqual(
  counts(duplicated),
  [1, 1, 1, 1, 1],
  "Unique owned records, not delivery attempts",
);
const invalid = syntheticFunnelSnapshot();
invalid.approvals.push({
  ...invalid.approvals[0],
  id: "later-rejection",
  status: "rejected",
  requestedAt: new Date("2026-10-02"),
  createdAt: new Date("2026-10-02"),
});
invalid.publications[0].projectId = "hidden-project";
invalid.records[2].payload = { status: "ready", completeness_score: 100, missing_fields: [] };
delete invalid.records[3].payload.sent_ref;
assert.deepEqual(
  counts(invalid, []),
  [0, 0, 0, 0, 0],
  "Status alone cannot substitute for traceable evidence",
);
assert.deepEqual(
  derive(invalid, []).stages.map((s) => s.excluded.length),
  [1, 1, 1, 1, 1],
);
assert.deepEqual(
  counts(syntheticFunnelSnapshot(), null),
  [1, 1, 1, 1, null],
  "Unavailable evidence is not zero or success",
);
const pending = syntheticFunnelSnapshot();
pending.records[0].state = "PRODUCT_REVIEW_REQUIRED";
pending.publications[0].status = "submitted";
pending.records[1].state = "CONTENT_APPROVED";
pending.records[2].state = "RFQ_COLLECTING";
pending.records[3].state = "QUOTE_APPROVED";
pending.records[4].state = "FOLLOW_UP";
pending.records[4].payload.score_band = "HOT";
assert.deepEqual(
  counts(pending),
  [0, 0, 0, 0, 0],
  "Drafts, pending receipts and HOT leads do not qualify",
);
const wrongApproval = syntheticFunnelSnapshot();
wrongApproval.records[3].payload.approval_ref = "unrelated-approval";
assert.equal(counts(wrongApproval)[3], 0);
const wrongOwner = syntheticFunnelSnapshot();
wrongOwner.records[0].projectId = "hidden-project";
assert.equal(counts(wrongOwner)[0], 0);
const safe = JSON.stringify(derive());
assert.ok(
  !safe.includes("SYNTHETIC-ONLY") && !safe.includes("synthetic-receipt"),
  "Raw business payloads must not leave projection",
);
for (const stage of derive().stages)
  for (const row of stage.records) {
    assert.ok(row.href.startsWith("/workspace/synthetic-project/"));
    assert.ok(row.href.includes("returnTo=%2Fworkspace"));
  }
console.log(
  "PASS business funnel: evidence, zero vs unknown, authorization scope, deduplication, no inferred cross-project conversions, safe trace links",
);
