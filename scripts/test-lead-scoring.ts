import assert from "node:assert/strict";
import { scoreLead } from "../lib/follow-up/lead-scoring";

assert.deepEqual(scoreLead(["active_inquiry"]), {
  raw_score: 20,
  score: 20,
  status: "COLD",
  evidence: [{ rule_id: "active_inquiry", points: 20 }],
});
assert.equal(
  scoreLead([
    "active_inquiry",
    "provides_oe_number",
    "explicit_quantity",
    "target_quantity_range",
    "asks_sample",
    "asks_lead_time",
    "asks_payment_terms",
    "replies_again",
  ]).score,
  100,
);
assert.equal(
  scoreLead(["active_inquiry", "provides_oe_number", "explicit_quantity"]).status,
  "WARM",
);
assert.equal(
  scoreLead([
    "active_inquiry",
    "provides_oe_number",
    "explicit_quantity",
    "target_quantity_range",
    "asks_sample",
    "asks_lead_time",
  ]).status,
  "HOT",
);
console.log("PASS lead scoring");
