import { z } from "zod";
import { facebookInboundMessageSchema } from "../social/facebook-inbound-schema";
export const inboxPacketSchema = z
  .object({
    runId: z.uuid(),
    leaseId: z.uuid(),
    requestId: z.uuid(),
    observedAt: z.iso.datetime(),
    messages: z.array(facebookInboundMessageSchema).min(1).max(20),
  })
  .strict();
export const inboxEnvelopeSchema = z
  .object({
    packet: inboxPacketSchema,
    signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
