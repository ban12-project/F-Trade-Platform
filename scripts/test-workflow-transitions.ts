import assert from "node:assert/strict";

import {
  type ApprovalDecision,
  assertTransition,
  replayTransitions,
  type WorkflowEventInput,
} from "../lib/workflow/transitions";

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

console.log("PASS workflow transition rules and replay");
