import assert from "node:assert/strict";
import { quotationDecisionFormSchema, quotationDraftFormSchema } from "../lib/form-schemas";
import {
  applyHumanQuoteDecision,
  createManualQuotation,
  sendManualQuotation,
} from "../lib/quotation/handoff";

const quoteInput = {
  projectId: "00000000-0000-4000-8000-000000000001",
  rfqId: "00000000-0000-4000-8000-000000000002",
  productId: "00000000-0000-4000-8000-000000000003",
  unitPrice: "12.50",
  currency: "USD",
  moq: "10",
  leadTimeDays: "30",
  paymentTerms: "MOCK terms",
  validityDays: "30",
  evidenceRef: "evidence-mock-quotation",
};
assert.equal(quotationDraftFormSchema.safeParse(quoteInput).success, true);
for (const evidenceRef of [undefined, "", "untraceable"]) {
  assert.equal(quotationDraftFormSchema.safeParse({ ...quoteInput, evidenceRef }).success, false);
}

const reviewInput = {
  projectId: quoteInput.projectId,
  quotationId: quoteInput.rfqId,
  reviewedVersion: "3",
  approvalId: quoteInput.productId,
  decision: "approved",
  evidenceRef: quoteInput.evidenceRef,
  notes: "",
};
assert.equal(quotationDecisionFormSchema.safeParse(reviewInput).success, true);
for (const reviewedVersion of [undefined, "", "0", "01", "1e3", "9007199254740992"]) {
  assert.equal(
    quotationDecisionFormSchema.safeParse({ ...reviewInput, reviewedVersion }).success,
    false,
  );
}
for (const approvalId of [undefined, "", "invalid"]) {
  assert.equal(
    quotationDecisionFormSchema.safeParse({ ...reviewInput, approvalId }).success,
    false,
  );
}

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
