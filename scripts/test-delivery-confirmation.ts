import assert from "node:assert/strict";
import {
  decideDeliveryConfirmation,
  expireDeliveryConfirmation,
  requestDeliveryConfirmation,
  validateDeliveryConfirmation,
} from "../lib/delivery/confirmation";
import { deliveryDecisionFormSchema } from "../lib/form-schemas";

const decisionInput = {
  projectId: "00000000-0000-4000-8000-000000000001",
  confirmationId: "00000000-0000-4000-8000-000000000002",
  decision: "confirmed",
  evidenceRef: "evidence-synthetic-delivery",
  leadTimeDays: "0",
  notes: "",
};
for (const leadTimeDays of ["0", "001", " 21 ", "9007199254740991"]) {
  assert.equal(
    deliveryDecisionFormSchema.safeParse({ ...decisionInput, leadTimeDays }).success,
    true,
  );
}
for (const leadTimeDays of [
  "",
  "-1",
  "1.5",
  "1e3",
  "9007199254740992",
  "9007199254740993",
  "9".repeat(400),
]) {
  assert.equal(
    deliveryDecisionFormSchema.safeParse({ ...decisionInput, leadTimeDays }).success,
    false,
  );
}
for (const leadTimeDays of ["", "9007199254740993"]) {
  assert.equal(
    deliveryDecisionFormSchema.safeParse({
      ...decisionInput,
      decision: "rejected",
      leadTimeDays,
      notes: "SYNTHETIC factory unable to confirm",
    }).success,
    true,
  );
}
assert.equal(
  deliveryDecisionFormSchema.safeParse({ ...decisionInput, decision: "rejected" }).success,
  false,
);

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
for (const leadTimeDays of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
  assert.throws(
    () =>
      decideDeliveryConfirmation(pending, {
        actorType: "human",
        actorId: "synthetic-factory",
        status: "confirmed",
        approvalRef: "synthetic-approval",
        evidenceRef: "synthetic-evidence",
        decidedAt: "2026-08-24T12:01:00Z",
        leadTimeDays,
        validUntil: "2026-08-31T12:01:00Z",
      }),
    /nonnegative safe integer/,
  );
  assert.throws(
    () =>
      validateDeliveryConfirmation({
        ...confirmed,
        result: { ...confirmed.result, confirmed_lead_time_days: leadTimeDays },
      }),
    /Contract validation failed/,
  );
}
const rejected = decideDeliveryConfirmation(pending, {
  actorType: "human",
  actorId: "synthetic-factory",
  status: "rejected",
  approvalRef: "synthetic-approval",
  evidenceRef: "synthetic-evidence",
  decidedAt: "2026-08-24T12:01:00Z",
  leadTimeDays: Number.MAX_SAFE_INTEGER + 1,
});
assert.equal(rejected.status, "rejected");
assert.equal(rejected.result?.confirmed_lead_time_days, undefined);
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
