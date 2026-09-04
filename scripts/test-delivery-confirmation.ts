import assert from "node:assert/strict";
import {
  decideDeliveryConfirmation,
  expireDeliveryConfirmation,
  requestDeliveryConfirmation,
} from "../lib/delivery/confirmation";

const pending = requestDeliveryConfirmation({
  confirmationId: "synthetic-delivery-02",
  relatedEntityType: "opportunity",
  relatedEntityId: "synthetic-opportunity-01",
  requestedByType: "agent",
  requestedById: "synthetic-agent",
  requestedAt: "2026-08-24T12:00:00Z",
});
const confirmed = decideDeliveryConfirmation(pending, {
  actorType: "human",
  actorId: "synthetic-factory",
  status: "confirmed",
  approvalRef: "synthetic-approval",
  evidenceRef: "synthetic-evidence",
  decidedAt: "2026-08-24T12:01:00Z",
  leadTimeDays: 0,
  validUntil: "2026-08-31T12:01:00Z",
});
assert.equal(confirmed.status, "confirmed");
assert.equal(confirmed.result?.valid_until, "2026-08-31T12:01:00Z");
assert.equal(expireDeliveryConfirmation(confirmed, "system").status, "expired");
assert.equal(expireDeliveryConfirmation(pending, "system").status, "expired");
assert.throws(
  () =>
    decideDeliveryConfirmation(pending, {
      actorType: "agent",
      actorId: "agent",
      status: "confirmed",
      approvalRef: "a",
      evidenceRef: "e",
      decidedAt: "2026-08-24T12:01:00Z",
      leadTimeDays: 1,
      validUntil: "2026-08-31T12:01:00Z",
    }),
  /human actor/,
);
assert.throws(
  () =>
    decideDeliveryConfirmation(pending, {
      actorType: "human",
      actorId: "human",
      status: "confirmed",
      approvalRef: "a",
      evidenceRef: "e",
      decidedAt: "2026-08-24T12:01:00Z",
      leadTimeDays: 1,
      validUntil: "2026-08-24T12:01:00Z",
    }),
  /future validity deadline/,
);
console.log("PASS Gate 03 delivery confirmation");
