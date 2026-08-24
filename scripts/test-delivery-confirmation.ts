import assert from "node:assert/strict";
import { decideDeliveryConfirmation, expireDeliveryConfirmation, requestDeliveryConfirmation } from "../lib/delivery/confirmation";
const pending = requestDeliveryConfirmation({ confirmationId: "synthetic-delivery-02", relatedEntityType: "opportunity", relatedEntityId: "synthetic-opportunity-01", requestedByType: "agent", requestedById: "synthetic-agent", requestedAt: "2026-08-24T12:00:00Z" });
assert.equal(decideDeliveryConfirmation(pending, { actorType: "human", actorId: "synthetic-factory", status: "confirmed", approvalRef: "synthetic-approval", evidenceRef: "synthetic-evidence", decidedAt: "2026-08-24T12:01:00Z", leadTimeDays: 0 }).status, "confirmed");
assert.equal(expireDeliveryConfirmation(pending, "system").status, "expired");
assert.throws(() => decideDeliveryConfirmation(pending, { actorType: "agent", actorId: "agent", status: "confirmed", approvalRef: "a", evidenceRef: "e", decidedAt: "2026-08-24T12:01:00Z", leadTimeDays: 1 }), /human actor/);
console.log("PASS Gate 03 delivery confirmation");
