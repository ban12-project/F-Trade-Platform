import assert from "node:assert/strict";
import { applyHumanQuoteDecision, createManualQuotation } from "../lib/quotation/handoff";
import { quotationValidityDays, quotationValiditySchema } from "../lib/quotation/validity";

const validity = {
  version: 1 as const,
  starts_on: "2026-03-07",
  expires_on: "2026-03-09",
  time_zone: "America/New_York",
};
assert.equal(quotationValidityDays(validity), 3);
assert.equal(quotationValidityDays({ ...validity, expires_on: validity.starts_on }), 1);
assert.equal(
  quotationValidityDays({ ...validity, starts_on: "2024-02-28", expires_on: "2024-03-01" }),
  3,
);
for (const change of [
  { starts_on: "2026-02-29" },
  { expires_on: "2026-03-06" },
  { time_zone: "Mars/Olympus" },
  { starts_on: "2026-03-07T00:00:00Z" },
  { version: 2 },
]) {
  assert.equal(quotationValiditySchema.safeParse({ ...validity, ...change }).success, false);
}
assert.equal(quotationValiditySchema.safeParse({ starts_on: validity.starts_on }).success, false);
console.log("Quotation validity calendar and boundary checks passed.");

const quote = {
  unit_price: 1,
  currency: "USD",
  moq: 1,
  lead_time_days: 0,
  payment_terms: "SYNTHETIC",
  validity_days: 3,
  validity,
};
const draft = createManualQuotation({
  handoffId: "synthetic",
  rfqId: "synthetic",
  actorType: "human",
  actorId: "synthetic",
  quote,
});
const approved = applyHumanQuoteDecision(draft, {
  actorType: "human",
  actorId: "synthetic",
  status: "approved",
  approvalRef: "synthetic",
  evidenceRef: "synthetic",
  decidedAt: "2026-03-01T12:00:00Z",
});
assert.deepEqual(approved.quote.validity, validity);
assert.throws(() =>
  createManualQuotation({
    handoffId: "synthetic",
    rfqId: "synthetic",
    actorType: "human",
    actorId: "synthetic",
    quote: { ...quote, validity_days: 2 },
  }),
);
assert.throws(() =>
  applyHumanQuoteDecision(
    { ...draft, quote: { ...quote, validity: { ...validity, time_zone: "Invalid/Zone" } } },
    {
      actorType: "human",
      actorId: "synthetic",
      status: "approved",
      approvalRef: "synthetic",
      evidenceRef: "synthetic",
      decidedAt: "2026-03-01T12:00:00Z",
    },
  ),
);
console.log("Quotation approval preserves validity and rejects inconsistent terms.");
