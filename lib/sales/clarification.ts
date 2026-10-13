import { updateRfqDraft } from "../rfq/assessment";

type Rfq = Record<string, any>;

export function applyInquiryMessage(rfq: Rfq, message: string) {
  const patch: Rfq = { product: {}, commercial: {} };
  // Only a single unambiguous explicit value is suggested. Unsupported prose stays manual.
  const unique = (pattern: RegExp) => {
    const matches = [...message.matchAll(pattern)];
    return matches.length === 1 ? matches[0] : undefined;
  };
  const quantity = unique(/(?<![\w.,+-])([1-9]\d*)\s*(?:pcs?|pieces?)\b/gi);
  // A single unit suffix can apply to a range/list, not just its final number.
  const beforeQuantity = quantity ? message.slice(0, quantity.index) : "";
  const afterQuantity = quantity ? message.slice((quantity.index ?? 0) + quantity[0].length) : "";
  const alternativeBefore = /\d\s*(?:to|or|and|[/&–—-])\s*$/i.test(beforeQuantity);
  const alternativeAfter = /^\s*(?:to|or|and|[/&–—-])\s*\d/i.test(afterQuantity);
  if (
    quantity &&
    !alternativeBefore &&
    !alternativeAfter &&
    Number.isSafeInteger(Number(quantity[1]))
  )
    patch.commercial.quantity = Number(quantity[1]);
  // Capture the whole token before validating; never silently shorten an OE.
  const oe = unique(/\b(?:oe|oem)\s*[:#-]\s*([^\s,;]+)/gi);
  if (oe && /^[A-Za-z0-9-]{3,240}$/.test(oe[1])) patch.product.oe_number = oe[1];
  const destination = unique(/\bdestination\s*[:=]\s*([A-Za-z][A-Za-z -]{2,239})(?=[,;.\n]|$)/gi);
  if (destination) patch.commercial.destination = destination[1].trim();
  const vehicle = unique(/\b(Toyota|Honda|Ford|Volkswagen)\s+([A-Za-z0-9 -]{2,100}?)\s+clutch\b/gi);
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
