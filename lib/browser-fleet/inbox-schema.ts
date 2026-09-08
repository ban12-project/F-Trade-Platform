import { z } from "zod";
import { facebookInboundMessageSchema } from "../social/facebook-inbound-schema";
export const inboxPacketSchema = z
  .object({
    runId: z.uuid(),
    leaseId: z.uuid(),
    requestId: z.uuid(),
    observedAt: z.iso.datetime(),
    messages: z.array(facebookInboundMessageSchema).max(20),
    completion: z
      .object({
        reviewRef: z.string().regex(/^evidence-[a-z0-9_-]{3,120}$/i),
        scanStartedAt: z.iso.datetime(),
        coverage: z.literal("visible_inbox"),
        conversationCount: z.number().int().min(0).max(200),
        messageCount: z.number().int().min(0).max(2000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => (value.completion ? value.messages.length === 0 : value.messages.length > 0));
export const inboxEnvelopeSchema = z
  .object({
    packet: inboxPacketSchema,
    signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
