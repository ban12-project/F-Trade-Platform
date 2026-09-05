import { z } from "zod";

import { encryptSocialMessageBody } from "./message-crypto";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const socialMessageRecordInputSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    conversationId: z.string().trim().min(1).max(240),
    externalMessageRef: z.string().trim().min(1).max(256),
    direction: z.enum(["inbound", "outbound"]),
    identityQuality: z.enum(["dom_id", "derived_fingerprint", "manual"]),
    body: z.string().trim().min(1).max(20_000),
    receivedAt: z.coerce.date(),
  })
  .strict();
export type SocialMessageRecordInput = z.infer<typeof socialMessageRecordInputSchema>;

export type StoredSocialMessageRecord = Omit<SocialMessageRecordInput, "body"> & {
  bodyCiphertext: string;
  expiresAt: Date;
};

/** Creates the database-safe record; plaintext is intentionally not returned. */
export function createStoredSocialMessageRecord(
  input: SocialMessageRecordInput,
): StoredSocialMessageRecord {
  const parsed = socialMessageRecordInputSchema.parse(input);
  return {
    id: parsed.id,
    conversationId: parsed.conversationId,
    externalMessageRef: parsed.externalMessageRef,
    direction: parsed.direction,
    identityQuality: parsed.identityQuality,
    bodyCiphertext: encryptSocialMessageBody(parsed.body),
    receivedAt: parsed.receivedAt,
    expiresAt: new Date(parsed.receivedAt.getTime() + RETENTION_MS),
  };
}
