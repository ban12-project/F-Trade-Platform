import assert from "node:assert/strict";
import { quotationDecisionFormSchema, quotationDraftFormSchema } from "../lib/form-schemas";
import { buildApprovedQuotationPreview } from "../lib/quotation/customer-preview";
import {
  applyHumanQuoteDecision,
  createManualQuotation,
  sendManualQuotation,
} from "../lib/quotation/handoff";
import type { QuotationEntry } from "../lib/sales/closing-store";
import type { RfqEntry } from "../lib/sales/store";

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

const previewEntry: QuotationEntry = {
  id: approved.handoff_id,
  version: 4,
  state: "QUOTE_APPROVED",
  createdAt: new Date("2026-08-24T00:00:00Z"),
  quotation: { ...approved, product_id: "synthetic-product" },
  productId: "synthetic-product",
  approvalId: approved.approval_ref ?? null,
  approvalStatus: "approved",
};
const previewRfq: RfqEntry = {
  id: approved.rfq_id,
  state: "RFQ_READY",
  createdAt: previewEntry.createdAt,
  productType: "clutch_kit",
  quantity: 125,
  destination: "Synthetic destination",
  missingFields: [],
  completenessScore: 100,
  formValues: {
    leadId: "",
    customerName: "Synthetic Buyer",
    customerCompany: "Synthetic Company",
    customerCountry: "",
    productType: "clutch_kit",
    oeNumber: "",
    vehicleBrand: "",
    vehicleModel: "",
    quantity: "125",
    destination: "Synthetic destination",
  },
};
const previewProduct = {
  id: previewEntry.productId,
  productName: "Synthetic clutch kit",
  internalSku: "MOCK-PREVIEW-001",
};
const beforePreview = JSON.stringify(previewEntry);
const preview = buildApprovedQuotationPreview(previewEntry, [previewRfq], [previewProduct]);
assert.ok(preview);
assert.match(preview.text, /Approved quotation record version: 4/);
assert.match(preview.text, /Customer: Synthetic Buyer/);
assert.match(preview.text, /Company: Synthetic Company/);
assert.match(preview.text, /Product: Synthetic clutch kit/);
assert.match(preview.text, /Product code: MOCK-PREVIEW-001/);
assert.match(preview.text, /Requested quantity: 125/);
assert.match(preview.text, /Unit price: USD 1/);
assert.match(preview.text, /Minimum order quantity: 1/);
assert.match(preview.text, /Lead time: 0 days/);
assert.match(preview.text, /Payment terms: synthetic/);
assert.match(preview.text, /Validity period: 1 days/);
assert.match(preview.text, /Validity start \/ expiry date: Not recorded/);
assert.doesNotMatch(
  preview.text,
  /2026-08-24|synthetic-sales-user|synthetic-quote-approval|Total:/,
);
assert.equal(JSON.stringify(previewEntry), beforePreview, "preview does not mark quotation sent");
assert.deepEqual(
  buildApprovedQuotationPreview(previewEntry, [previewRfq], [previewProduct]),
  preview,
  "repeated formatting is deterministic and read-only",
);

for (const state of ["QUOTE_REVIEW_REQUIRED", "QUOTE_REVISION_REQUIRED", "QUOTE_SENT"])
  assert.equal(buildApprovedQuotationPreview({ ...previewEntry, state }, [], []), null);
for (const approvalStatus of ["pending", "rejected", null] as const)
  assert.equal(buildApprovedQuotationPreview({ ...previewEntry, approvalStatus }, [], []), null);
for (const approvalId of [null, "synthetic-stale-approval"])
  assert.equal(buildApprovedQuotationPreview({ ...previewEntry, approvalId }, [], []), null);
for (const version of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
  assert.equal(buildApprovedQuotationPreview({ ...previewEntry, version }, [], []), null);
assert.equal(buildApprovedQuotationPreview({ ...previewEntry, quotation: draft }, [], []), null);
assert.equal(
  buildApprovedQuotationPreview({ ...previewEntry, id: "synthetic-wrong-record" }, [], []),
  null,
);
const unavailable = buildApprovedQuotationPreview(
  previewEntry,
  [{ ...previewRfq, id: "synthetic-unrelated-rfq" }],
  [{ ...previewProduct, id: "synthetic-unrelated-product" }],
);
assert.ok(unavailable);
assert.match(unavailable.text, /Customer: Not recorded; please confirm/);
assert.match(unavailable.text, /Product: Not recorded; please confirm/);
assert.match(unavailable.text, /Requested quantity: Not recorded; please confirm/);
assert.doesNotMatch(unavailable.text, /Synthetic Buyer|Synthetic clutch kit|125/);
const missingProductId = buildApprovedQuotationPreview(
  { ...previewEntry, quotation: { ...previewEntry.quotation, product_id: undefined } },
  [{ ...previewRfq, quantity: null }],
  [previewProduct],
);
assert.ok(missingProductId);
assert.match(missingProductId.text, /Product: Not recorded; please confirm/);
assert.match(missingProductId.text, /Requested quantity: Not recorded; please confirm/);
console.log("PASS approved quotation customer preview and fail-closed source matching");
