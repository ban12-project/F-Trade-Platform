import { compileContract } from "../contracts/validator";
import quotationHandoffSchema from "../../contracts/sales/quotation-handoff.schema.json";

export type Quote = {
  unit_price: number;
  currency: string;
  moq: number;
  lead_time_days: number;
  payment_terms: string;
  validity_days: number;
};

export interface ManualQuotationInput {
  handoffId: string;
  rfqId: string;
  actorType: "human" | "agent" | "system";
  actorId: string;
  quote: Quote;
}

export interface HumanQuoteDecision {
  actorType: "human" | "agent" | "system";
  actorId: string;
  status: "approved" | "rejected";
  approvalRef: string;
  evidenceRef: string;
  decidedAt: string;
}

export type QuotationHandoff = {
  handoff_id: string;
  rfq_id: string;
  product_id?: string;
  created_by_actor_type: "human";
  created_by_actor_id: string;
  status: "draft" | "review_required" | "revision_required" | "approved" | "sent";
  quote: Quote;
  approval_ref?: string;
  sent_at?: string;
  sent_channel?: string;
  sent_ref?: string;
};

const validateQuotation = compileContract<QuotationHandoff>(quotationHandoffSchema);

function assertNonEmpty(value: string, name: string) {
  if (!value.trim()) throw new Error(`Quotation handoff requires ${name}`);
}

/** Creates a private quotation handoff. Agents and systems cannot author price terms. */
export function createManualQuotation(input: ManualQuotationInput): QuotationHandoff {
  if (input.actorType !== "human") {
    throw new Error("Only a human actor can create a formal quotation");
  }
  assertNonEmpty(input.handoffId, "handoffId");
  assertNonEmpty(input.rfqId, "rfqId");
  assertNonEmpty(input.actorId, "actorId");
  return validateQuotation({
    handoff_id: input.handoffId,
    rfq_id: input.rfqId,
    created_by_actor_type: "human",
    created_by_actor_id: input.actorId,
    status: "review_required",
    quote: input.quote,
  });
}

/** Records a human Gate 02 decision. A rejected quote returns to revision required. */
export function applyHumanQuoteDecision(
  quotation: QuotationHandoff,
  decision: HumanQuoteDecision,
): QuotationHandoff {
  if (quotation.status !== "review_required") {
    throw new Error("Only a quotation awaiting review can receive a Gate 02 decision");
  }
  if (decision.actorType !== "human") {
    throw new Error("Gate 02 decisions require a human actor");
  }
  for (const [value, name] of Object.entries({
    actorId: decision.actorId,
    approvalRef: decision.approvalRef,
    evidenceRef: decision.evidenceRef,
  })) {
    assertNonEmpty(value, name);
  }
  if (Number.isNaN(Date.parse(decision.decidedAt))) {
    throw new Error("Gate 02 decisions require an ISO date-time");
  }
  return validateQuotation({
    ...quotation,
    status: decision.status === "approved" ? "approved" : "revision_required",
    approval_ref: decision.approvalRef,
  });
}

/** Marks an approved quotation as sent. This deliberately has no agent actor path. */
export function sendManualQuotation(
  quotation: QuotationHandoff,
  actorType: ManualQuotationInput["actorType"],
  actorId: string,
  sentAt: string,
  sentChannel: string,
  sentRef: string,
): QuotationHandoff {
  if (actorType !== "human") throw new Error("An agent cannot send a formal quotation");
  if (quotation.status !== "approved" || !quotation.approval_ref) {
    throw new Error("Only a Gate 02-approved quotation can be sent");
  }
  assertNonEmpty(actorId, "actorId");
  assertNonEmpty(sentChannel, "sentChannel");
  assertNonEmpty(sentRef, "sentRef");
  if (Number.isNaN(Date.parse(sentAt))) throw new Error("Quotation send time must be an ISO date-time");
  return validateQuotation({ ...quotation, status: "sent", sent_at: sentAt, sent_channel: sentChannel, sent_ref: sentRef });
}
