import assert from "node:assert/strict";

import {
  decideDeliveryConfirmation,
  requestDeliveryConfirmation,
} from "../lib/delivery/confirmation";
import { buildControlledReply } from "../lib/follow-up/controlled-reply";

const pending = requestDeliveryConfirmation({
  confirmationId: "delivery-001",
  relatedEntityType: "rfq",
  relatedEntityId: "rfq-001",
  requestedByType: "human",
  requestedById: "sales-001",
  requestedAt: "2026-09-01T00:00:00Z",
});
const confirmed = decideDeliveryConfirmation(pending, {
  actorType: "human",
  actorId: "reviewer-001",
  status: "confirmed",
  approvalRef: "approval-001",
  evidenceRef: "evidence-001",
  decidedAt: "2026-09-01T01:00:00Z",
  leadTimeDays: 21,
  validUntil: "2026-09-08T01:00:00Z",
});

assert.equal(
  buildControlledReply({
    draft: "Thank you for checking.",
    context: "asks_lead_time",
    rfqRef: "rfq-001",
    delivery: confirmed,
    now: new Date("2026-09-04T00:00:00Z"),
  }),
  "Thank you for checking.\n\nConfirmed lead time: 21 days. Valid through 2026-09-08 (Gate 03).",
);
assert.throws(
  () =>
    buildControlledReply({
      draft: "Thank you.",
      context: "asks_lead_time",
      rfqRef: "rfq-001",
      delivery: null,
      now: new Date("2026-09-04T00:00:00Z"),
    }),
  /必须先完成 Gate 03/,
);
assert.throws(
  () =>
    buildControlledReply({
      draft: "Delivery in 18 days.",
      context: "quote_sent_read_no_reply",
      rfqRef: "rfq-001",
      delivery: null,
      now: new Date("2026-09-04T00:00:00Z"),
    }),
  /自由文本不能包含交期承诺/,
);
assert.throws(
  () =>
    buildControlledReply({
      draft: "Thank you.",
      context: "asks_sample",
      rfqRef: "rfq-001",
      delivery: confirmed,
      now: new Date("2026-09-09T00:00:00Z"),
    }),
  /已过期/,
);

console.log("PASS Gate 03 controlled reply insertion");
