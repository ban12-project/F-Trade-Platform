import { updateRfqDraft } from "../rfq/completeness";

type Rfq = Record<string, any>;

export function applyInquiryMessage(rfq: Rfq, message: string) {
  const patch: Rfq = { product: {}, commercial: {} };
  const quantity = message.match(/\b(\d+)\s*(?:pcs?|pieces?)\b/i);
  if (quantity) patch.commercial.quantity = Number(quantity[1]);
  const oe = message.match(/\b(?:oe|oem)\s*[:#-]?\s*([A-Za-z0-9-]{3,})\b/i);
  if (oe) patch.product.oe_number = oe[1];
  const destination = message.match(
    /\b(?:to\s+|destination\s*[:=-]?\s*)([A-Za-z][A-Za-z -]{2,})\b/i,
  );
  if (destination) patch.commercial.destination = destination[1].trim();
  const vehicle = message.match(
    /\b(Toyota|Honda|Ford|Volkswagen)\s+([A-Za-z0-9 -]{2,}?)(?:\s+clutch|,|\.|$)/i,
  );
  if (vehicle) {
    patch.product.vehicle_brand = vehicle[1];
    patch.product.vehicle_model = vehicle[2].trim();
  }
  return updateRfqDraft(rfq, patch);
}

export function nextClarification(rfq: Rfq) {
  const missing = rfq.missing_fields as string[];
  const first = missing[0];
  if (!first)
    return {
      status: "ready" as const,
      message: "RFQ is complete and ready for human quotation handoff.",
    };
  const prompts: Record<string, string> = {
    product_type: "Which clutch component do you need?",
    vehicle_model_or_oe_number:
      "Please provide the OE number or the exact vehicle brand and model.",
    quantity: "What quantity do you need?",
    destination: "What is the destination country or port?",
  };
  return {
    status: "clarification_required" as const,
    field: first,
    message: prompts[first] ?? "Please provide the missing RFQ detail.",
  };
}

export function assertNoAgentQuotation(rfq: Rfq) {
  if (rfq.missing_fields.length)
    throw new Error("Agent must continue clarification and cannot quote an incomplete RFQ");
  throw new Error("Agent cannot send a formal quotation; hand off to a human");
}
