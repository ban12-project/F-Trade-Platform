import readySchema from "../../contracts/sales/rfq-ready.schema.json";
import { compileContract } from "../contracts/validator";
import { assessRfq } from "./assessment";

type Rfq = Record<string, any>;
const validateReady = compileContract<Rfq>(readySchema);

export { assessRfq, updateRfqDraft } from "./assessment";

export function promoteRfqReady(rfq: Rfq) {
  const assessment = assessRfq(rfq);
  if (!assessment.ready)
    throw new Error(`RFQ is incomplete: ${assessment.missing_fields.join(", ")}`);
  const { ready: _ready, ...derived } = assessment;
  return validateReady({ ...rfq, status: "ready", ...derived, missing_fields: [] });
}
