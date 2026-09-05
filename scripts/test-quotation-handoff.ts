import assert from "node:assert/strict";

import {
  applyHumanQuoteDecision,
  createManualQuotation,
  sendManualQuotation,
} from "../lib/quotation/handoff";

const draft = createManualQuotation({
  handoffId: "synthetic-handoff-gate-02",
  rfqId: "synthetic-rfq-ready-001",
  actorType: "human",
  actorId: "synthetic-sales-user",
  quote: {
    unit_price: 1,
    currency: "USD",
    moq: 1,
    lead_time_days: 0,
    payment_terms: "synthetic",
    validity_days: 1,
  },
});
const approved = applyHumanQuoteDecision(draft, {
  actorType: "human",
  actorId: "synthetic-quote-reviewer",
  status: "approved",
  approvalRef: "synthetic-quote-approval-gate-02",
  evidenceRef: "synthetic-quote-evidence-gate-02",
  decidedAt: "2026-08-24T12:00:00Z",
});
assert.equal(
  sendManualQuotation(
    approved,
    "human",
    "synthetic-sales-user",
    "2026-08-24T12:01:00Z",
    "synthetic-channel",
    "evidence-quote-send-001",
  ).status,
  "sent",
);
assert.throws(
  () =>
    createManualQuotation({
      handoffId: "synthetic-agent-handoff",
      rfqId: "synthetic-rfq-ready-001",
      actorType: "agent",
      actorId: "synthetic-agent",
      quote: draft.quote,
    }),
  /human actor/,
);
assert.throws(
  () =>
    applyHumanQuoteDecision(draft, {
      actorType: "agent",
      actorId: "agent",
      status: "approved",
      approvalRef: "a",
      evidenceRef: "e",
      decidedAt: "2026-08-24T12:00:00Z",
    }),
  /human actor/,
);
assert.throws(
  () =>
    sendManualQuotation(
      approved,
      "agent",
      "synthetic-agent",
      "2026-08-24T12:01:00Z",
      "synthetic-channel",
      "evidence-quote-send-002",
    ),
  /agent cannot send/,
);
console.log("PASS Gate 02 quotation handoff");
