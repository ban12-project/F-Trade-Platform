import assert from "node:assert/strict";

import { finalizeProductAgentDraft } from "../lib/product/agent";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";
import { runReferenceMockWorkflow } from "./reference-mock-workflow";
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
  const source = {
    record_id: "synthetic-source-20",
    source_ref: "synthetic:original",
    evidence_refs: ["synthetic:original"],
    source_text: "Internal SKU: SYN-BASE-20\nVehicle model: SYN Model 20",
    image_availability: "none" as const,
    image_refs: [],
  };
  const prepared = prepareProductAgentEvidenceSource(source);
  const draft = finalizeProductAgentDraft(
    {
      record_id: source.record_id,
      source_ref: source.source_ref,
      evidence_refs: prepared.evidence_refs,
      verification_status: "review_required",
      product: { internal_sku: "SYN-BASE-20", vehicle_model: "SYN Model 20" },
      field_evidence: {
        "product.internal_sku": prepared.evidence_locations[0]?.ref,
        "product.vehicle_model": prepared.evidence_locations[1]?.ref,
      },
      blocking_missing_fields: [],
      optional_missing_fields: [],
    },
    prepared,
  );
  const before = JSON.stringify({ source, draft });
  const mockRun = await runReferenceMockWorkflow(source, draft, 20);
  assert.equal(JSON.stringify({ source, draft }), before);
  assert.deepEqual(mockRun.mocked_fields, [
    "product.product_name",
    "product.product_type",
    "product.oe_numbers",
  ]);
  assert.equal(mockRun.ready.product.internal_sku, "SYN-BASE-20");
  assert.equal(mockRun.ready.product.vehicle_model, "SYN Model 20");
  assert.equal(
    mockRun.ready.field_evidence["product.vehicle_model"],
    draft.field_evidence["product.vehicle_model"],
  );
  assert.ok(
    mockRun.mock_source.evidence_refs.includes(
      mockRun.ready.field_evidence["product.product_name"] ?? "",
    ),
  );
  assert.equal(mockRun.downstream.inputLinks.productId, mockRun.ready.record_id);
  assert.equal(mockRun.downstream.inputLinks.contentProductId, mockRun.ready.record_id);
  assert.equal(mockRun.downstream.inputLinks.rfqOe, "MOCK-OE-SLOT-20");
  assert.equal(mockRun.downstream.finalStates.lead, "OPPORTUNITY");
  assert.equal(mockRun.business_database_writes, false);
  await assert.rejects(
    () =>
      runReferenceMockWorkflow(
        source,
        { ...draft, product: { ...draft.product, vehicle_model: "Invented" } },
        20,
      ),
    /explicitly labelled/,
  );
  await assert.rejects(
    () => runSyntheticDemo({ ...mockRun.ready, record_id: "business-product" }),
    /synthetic identifier/,
  );
  console.log("PASS synthetic end-to-end demo and isolated reference mock supplements");
}

void main();
