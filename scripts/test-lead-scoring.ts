import assert from "node:assert/strict";
import leadContract from "../contracts/sales/lead.schema.json";
import { followUpFormSchema } from "../lib/follow-up/form-schemas";
import { firstHotScore, scoreLead } from "../lib/follow-up/lead-scoring";

const weights = {
  active_inquiry: 20,
  provides_oe_number: 15,
  explicit_quantity: 15,
  target_quantity_range: 10,
  asks_sample: 10,
  asks_lead_time: 10,
  asks_payment_terms: 15,
  replies_again: 15,
};
const ids = Object.keys(weights);
for (let mask = 0; mask < 2 ** ids.length; mask++) {
  const selected = Object.entries(weights).filter((_, index) => mask & (1 << index));
  const raw = selected.reduce((sum, [, points]) => sum + points, 0);
  assert.deepEqual(scoreLead(selected.map(([id]) => id)), {
    raw_score: raw,
    score: Math.min(100, raw),
    status: raw <= 30 ? "COLD" : raw <= 60 ? "WARM" : "HOT",
    evidence: selected.map(([rule_id, points]) => ({ rule_id, points })),
  });
}
assert.deepEqual(
  scoreLead([
    "asks_sample",
    "active_inquiry",
    "asks_sample",
    "unknown",
    "constructor",
    "__proto__",
  ]),
  scoreLead(["asks_sample", "active_inquiry"]),
);

assert.equal(firstHotScore, 61);
assert.equal(scoreLead(ids).score, leadContract.properties.score.maximum);

const input = followUpFormSchema.shape.triggeredRules;
assert.deepEqual(input.parse(ids), ids);
assert.equal(input.safeParse(["unknown"]).success, false);
assert.equal(input.safeParse([...ids, ids[0]]).success, false);
console.log("PASS lead scoring and follow-up inputs");
