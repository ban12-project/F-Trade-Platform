import { timingSafeEqual } from "node:crypto";
import { inboxEnvelopeSchema, inboxPacketSchema } from "./inbox-schema";
import { inboxSignature as signature } from "./inbox-signature.mjs";

export function signInboxPacket(secret: string, input: unknown) {
  const packet = inboxPacketSchema.parse(input);
  return { packet, signature: signature(secret, packet) };
}
export function verifyInboxPacket(secret: string, input: unknown) {
  const envelope = inboxEnvelopeSchema.parse(input);
  if (
    !timingSafeEqual(
      Buffer.from(envelope.signature),
      Buffer.from(signature(secret, envelope.packet)),
    )
  )
    throw new Error("inbox_signature_invalid");
  return envelope.packet;
}
