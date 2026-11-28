import assert from "node:assert/strict";

import delivery from "../contracts/sales/delivery-confirmation.schema.json";
import approval from "../contracts/workflow/human-approval.schema.json";
import event from "../contracts/workflow/workflow-event.schema.json";
import {
  type ApprovalDecision,
  assertTransition,
  replayTransitions,
  type WorkflowEventInput,
} from "../lib/workflow/transitions";
import { actorTypes, aggregateTypes, humanGates } from "../lib/workflow/vocabulary";

// Exchange schemas can expose a subset of aggregates. Actor and gate vocabularies agree.
assert.deepEqual(new Set(event.properties.actor_type.enum), new Set(actorTypes));
assert.deepEqual(new Set(approval.properties.requested_by_type.enum), new Set(actorTypes));
assert.deepEqual(new Set(delivery.properties.requested_by_type.enum), new Set(actorTypes));
assert.deepEqual(new Set(event.properties.gate.enum), new Set(humanGates));
assert.deepEqual(new Set(approval.properties.gate.enum), new Set(humanGates));
for (const schema of [event, approval]) {
  for (const entity of schema.properties.entity_type.enum) {
    assert.ok(
      aggregateTypes.some((type) => type === entity),
      entity,
    );
  }
}

const approvedTruth: ApprovalDecision = {
  id: "approval-01",
  aggregateId: "product-01",
  gate: "gate_01_truth",
  status: "approved",
  decidedByType: "human",
  decidedById: "reviewer-01",
  evidenceRef: "evidence-review-01",
};

const productApproved: WorkflowEventInput = {
  eventId: "event-01",
  entityType: "product",
  entityId: "product-01",
  fromState: "PRODUCT_REVIEW_REQUIRED",
  toState: "PRODUCT_READY",
  actorType: "human",
  actorId: "reviewer-01",
  occurredAt: "2026-08-24T08:00:00Z",
  evidenceRefs: ["evidence-review-01"],
  gate: "gate_01_truth",
  approvalRef: "approval-01",
};

assertTransition(productApproved, approvedTruth);
assert.equal(
  replayTransitions("product", "product-01", "PRODUCT_REVIEW_REQUIRED", [
    { event: productApproved, approval: approvedTruth },
  ]),
  "PRODUCT_READY",
);

assert.throws(
  () => assertTransition({ ...productApproved, actorType: "agent" }, approvedTruth),
  /cannot perform/,
);
assert.throws(
  () => assertTransition({ ...productApproved, approvalRef: undefined }, approvedTruth),
  /requires gate_01_truth approval/,
);
assert.throws(
  () =>
    replayTransitions("product", "product-01", "PRODUCT_REVIEW_REQUIRED", [
      { event: productApproved, approval: approvedTruth },
      { event: productApproved, approval: approvedTruth },
    ]),
  /duplicated/,
);

const rfqReady: WorkflowEventInput = {
  eventId: "event-rfq-01",
  entityType: "rfq",
  entityId: "rfq-01",
  fromState: "RFQ_COLLECTING",
  toState: "RFQ_READY",
  actorType: "agent",
  actorId: "sales-agent-01",
  occurredAt: "2026-08-24T08:01:00Z",
  evidenceRefs: ["rfq-completeness-01"],
};
assertTransition(rfqReady);
assert.throws(() => assertTransition({ ...rfqReady, toState: "QUOTE_APPROVED" }), /cannot move/);
assert.throws(() => assertTransition({ ...rfqReady, evidenceRefs: [] }), /at least one reference/);

const deliveryExpired: WorkflowEventInput = {
  eventId: "event-delivery-expired-01",
  entityType: "delivery_confirmation",
  entityId: "synthetic-delivery-01",
  fromState: "DELIVERY_CONFIRMATION_CONFIRMED",
  toState: "DELIVERY_CONFIRMATION_EXPIRED",
  actorType: "system",
  actorId: "delivery-confirmation-expiry",
  occurredAt: "2026-10-06T08:00:00Z",
  evidenceRefs: ["evidence-synthetic-delivery-renewal"],
};
assertTransition(deliveryExpired);
for (const actorType of ["agent", "human"] as const)
  assert.throws(() => assertTransition({ ...deliveryExpired, actorType }), /cannot perform/);
assert.equal(
  replayTransitions("delivery_confirmation", deliveryExpired.entityId, deliveryExpired.fromState, [
    { event: deliveryExpired },
  ]),
  "DELIVERY_CONFIRMATION_EXPIRED",
);

console.log("PASS workflow transition rules and replay");
