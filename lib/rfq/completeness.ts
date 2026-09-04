import readySchema from "../../contracts/sales/rfq-ready.schema.json";
import { compileContract } from "../contracts/validator";

type Rfq = Record<string, any>;
const validateReady = compileContract<Rfq>(readySchema);

export function assessRfq(rfq: Rfq) {
  const product = rfq.product ?? {};
  const commercial = rfq.commercial ?? {};
  const missing: string[] = [];
  let score = 0;
  if (product.product_type) score += 10;
  else missing.push("product_type");
  if (product.oe_number || (product.vehicle_brand && product.vehicle_model)) score += 40;
  else missing.push("vehicle_model_or_oe_number");
  if (Number.isInteger(commercial.quantity) && commercial.quantity > 0) score += 25;
  else missing.push("quantity");
  if (typeof commercial.destination === "string" && commercial.destination.trim()) score += 25;
  else missing.push("destination");
  return { completeness_score: score, missing_fields: missing, ready: missing.length === 0 };
}

export function updateRfqDraft(rfq: Rfq, patch: Rfq) {
  const next = {
    ...rfq,
    ...patch,
    product: { ...(rfq.product ?? {}), ...(patch.product ?? {}) },
    commercial: { ...(rfq.commercial ?? {}), ...(patch.commercial ?? {}) },
  };
  const { ready: _ready, ...assessment } = assessRfq(next);
  return { ...next, status: "collecting", ...assessment };
}

export function promoteRfqReady(rfq: Rfq) {
  const assessment = assessRfq(rfq);
  if (!assessment.ready)
    throw new Error(`RFQ is incomplete: ${assessment.missing_fields.join(", ")}`);
  const { ready: _ready, ...derived } = assessment;
  return validateReady({ ...rfq, status: "ready", ...derived, missing_fields: [] });
}
