import { z } from "zod";

import { validateInboundChannelEvent, type ChannelInboundPolicy, type InboundChannelEvent } from "./inbound-policy";

export const inboundLeadIntakeInputSchema = z.object({
  conversationRef: z.string().trim().min(1).max(240),
  leadRef: z.string().trim().min(1).max(240),
  messageRecordRef: z.string().trim().min(1).max(240),
  requestedProductType: z.string().trim().min(1).max(160).optional(),
  requestedQuantity: z.number().int().positive().max(10_000_000).optional(),
  destinationCountry: z.string().trim().min(2).max(100).optional(),
}).strict();
export type InboundLeadIntakeInput = z.infer<typeof inboundLeadIntakeInputSchema>;

/**
 * Turns a verified passive inbound event into an internal lead/RFQ collection
 * task. The caller is intentionally not given any outbound-message capability.
 */
export function createInboundLeadIntake(
  policy: ChannelInboundPolicy,
  event: InboundChannelEvent,
  input: InboundLeadIntakeInput,
) {
  const message = validateInboundChannelEvent(policy, event);
  const parsed = inboundLeadIntakeInputSchema.parse(input);
  return {
    action: "create_or_update_lead" as const,
    channelRef: policy.channelRef,
    accountRef: policy.accountRef,
    conversationRef: parsed.conversationRef,
    leadRef: parsed.leadRef,
    messageRecordRef: parsed.messageRecordRef,
    source: "passive_social_inbound" as const,
    messageId: message.messageId,
    receivedAt: message.receivedAt,
    observationRef: event.transport === "controlled_browser_observation" ? event.observationRef : undefined,
    identityQuality: event.transport === "controlled_browser_observation" ? event.messageIdentityQuality : "dom_id" as const,
    rfqCollection: {
      productType: parsed.requestedProductType ?? null,
      quantity: parsed.requestedQuantity ?? null,
      destinationCountry: parsed.destinationCountry ?? null,
    },
  };
}
