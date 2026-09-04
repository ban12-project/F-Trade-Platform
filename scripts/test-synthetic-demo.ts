import assert from "node:assert/strict";

import { runSyntheticDemo } from "./run-synthetic-demo";

async function main() {
  const report = await runSyntheticDemo();
  assert.equal(report.classification, "synthetic");
  assert.deepEqual(report.finalStates, {
    product: "PRODUCT_READY",
    content: "CONTENT_PUBLISHED",
    video: "VIDEO_APPROVED",
    rfq: "RFQ_READY",
    quotation: "QUOTE_SENT",
    lead: "OPPORTUNITY",
    delivery: "DELIVERY_CONFIRMATION_CONFIRMED",
  });
  assert.equal(report.transitionCount, 14);
  assert.deepEqual(report.approvedGates, ["gate_01_truth", "gate_02_quote", "gate_03_delivery"]);
  assert.deepEqual(report.inboundMessaging, {
    deliveryStatus: "accepted",
    duplicateStatus: "duplicate",
    replyWindowStatus: "within_window",
    outsideWindowAction: "require_human_approved_template",
  });
  assert.deepEqual(report.publicationTransport, {
    status: "published",
    transport: "camofox_controlled_mvp1",
    jobStatus: "succeeded",
    signedResultVerified: true,
  });
  assert.deepEqual(report.followUp, { actorType: "human", replyWindowRevalidated: true });
  console.log("PASS synthetic end-to-end demo");
}

void main();
