import assert from "node:assert/strict";
import { assessRfq, promoteRfqReady, updateRfqDraft } from "../lib/rfq/completeness";

const draft = {
  rfq_id: "synthetic-rfq-test",
  customer: {},
  product: { product_type: "clutch_kit", vehicle_brand: "Synthetic" },
  commercial: { quantity: 1 },
};
assert.deepEqual(assessRfq(draft), {
  completeness_score: 35,
  missing_fields: ["vehicle_model_or_oe_number", "destination"],
  ready: false,
});
const filled = updateRfqDraft(draft, {
  product: { vehicle_model: "Demo" },
  commercial: { destination: "Synthetic" },
});
assert.equal(promoteRfqReady(filled).status, "ready");
assert.throws(() => promoteRfqReady(draft), /incomplete/);
console.log("PASS RFQ completeness rules");
