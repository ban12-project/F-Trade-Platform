import { z } from "zod";

const reference = z.string().trim().min(1).max(200);
export const facebookInboundMessageSchema = z
  .object({
    conversationRef: reference,
    messageRef: reference,
    direction: z.literal("inbound"),
    identityQuality: z.literal("dom_id"),
    body: z.string().trim().min(1).max(20_000),
    receivedAt: z.iso.datetime(),
  })
  .strict();
