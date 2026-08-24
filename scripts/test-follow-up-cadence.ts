import assert from "node:assert/strict";
import { nextFollowUp } from "../lib/follow-up/cadence";
assert.equal(nextFollowUp("quote_sent_unread").human_escalation, false);
assert.equal(nextFollowUp("price_high").human_escalation, true);
assert.equal(nextFollowUp("asks_lead_time").prohibited, "agent_commitment");
console.log("PASS context-aware follow-up cadence");
