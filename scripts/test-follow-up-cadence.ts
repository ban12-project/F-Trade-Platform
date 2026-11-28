import assert from "node:assert/strict";
import lead from "../contracts/sales/lead.schema.json";
import {
  followUpContexts,
  needsDeliveryConfirmation,
  nextFollowUp,
} from "../lib/follow-up/cadence";
import { followUpPlanFormSchema } from "../lib/follow-up/form-schemas";

const scenarios = [
  ["quote_sent_unread", "wait_then_reference_quote_validity", false, false],
  ["quote_sent_read_no_reply", "ask_one_decision_blocking_question", false, false],
  ["price_high", "ask_target_budget_and_escalate", true, false],
  ["purchase_later", "record_timing_and_request_follow_up_consent", false, false],
  ["asks_sample", "collect_sample_requirements_and_escalate", true, true],
  ["asks_lead_time", "request_factory_delivery_confirmation", true, true],
] as const;
assert.deepEqual(
  followUpContexts,
  scenarios.map(([id]) => id),
);
assert.deepEqual(new Set(followUpContexts), new Set(lead.properties.follow_up_context.enum));
for (const [context, action, human_escalation, requiresDelivery] of scenarios) {
  assert.equal(followUpPlanFormSchema.shape.context.parse(context), context);
  assert.deepEqual(nextFollowUp(context), {
    action,
    human_escalation,
    prohibited: human_escalation ? "agent_commitment" : "repetitive_generic_follow_up",
  });
  assert.equal(needsDeliveryConfirmation(context), requiresDelivery);
}
assert.equal(followUpPlanFormSchema.shape.context.safeParse("unknown").success, false);
assert.equal(needsDeliveryConfirmation(undefined), false);
console.log("PASS follow-up contexts, recommendations and Gate 03 applicability");
