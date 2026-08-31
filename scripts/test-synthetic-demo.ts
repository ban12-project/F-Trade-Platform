import assert from "node:assert/strict";

import { runSyntheticDemo } from "./run-synthetic-demo";

async function main() {
  const report = await runSyntheticDemo();
  assert.equal(report.classification, "synthetic");
  assert.deepEqual(report.finalStates, {
    product: "PRODUCT_READY",
    content: "CONTENT_PUBLISHED",
    rfq: "RFQ_READY",
    quotation: "QUOTE_SENT",
    lead: "OPPORTUNITY",
  });
  assert.equal(report.transitionCount, 11);
  assert.deepEqual(report.approvedGates, ["gate_01_truth", "gate_02_quote"]);
  assert.deepEqual(report.inboundMessaging, {
    deliveryStatus: "accepted",
    duplicateStatus: "duplicate",
    replyWindowStatus: "within_window",
    outsideWindowAction: "require_human_approved_template",
  });
  assert.deepEqual(report.publicationTransport, {
    status: "published",
    transport: "camofox_controlled_mvp1",
  });
  console.log("PASS synthetic end-to-end demo");
}

void main();
