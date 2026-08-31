import { assessReplyWindow, type ChannelInboundPolicy, type InboundMessageReference } from "./inbound-policy";

const TEMPLATE_BY_FIELD = {
  product_type: "To prepare your RFQ, please share the product type or OE reference.",
  quantity: "To prepare your RFQ, please share the required quantity.",
  destination: "To prepare your RFQ, please share the destination country or port.",
} as const;
type SupportedField = keyof typeof TEMPLATE_BY_FIELD;

export function createBoundedRfqReply(
  policy: ChannelInboundPolicy,
  inbound: InboundMessageReference,
  now: string,
  missingField: string,
) {
  const window = assessReplyWindow(policy, inbound, now);
  if (!window.automatedReplyAllowed) throw new Error("Automated RFQ reply is outside the allowed reply window");
  if (!(missingField in TEMPLATE_BY_FIELD)) throw new Error("RFQ reply requires human handling for this field");
  const field = missingField as SupportedField;
  return { action: "reply" as const, templateId: `rfq_missing_${field}`, body: TEMPLATE_BY_FIELD[field] };
}
