import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseTransaction } from "@/lib/db/client";
import {
  auditEvent,
  socialChannelControl,
  socialConversation,
  socialMessage,
} from "@/lib/db/schema";
import {
  facebookInboundMessageSchema,
  facebookWorkerScopeSchema,
} from "./facebook-worker-protocol";
import { decryptSocialMessageBody } from "./message-crypto";
import { createStoredSocialMessageRecord } from "./message-record";

const batchSchema = z
  .object({
    channelRef: facebookWorkerScopeSchema.shape.channelRef,
    accountRef: facebookWorkerScopeSchema.shape.accountRef,
    observedAt: z.iso.datetime(),
    messages: z.array(facebookInboundMessageSchema).min(1).max(20),
  })
  .strict();

/** Transaction-only domain boundary. The transport must authenticate the worker
 * and bind channel/account to its live lease before calling. Never creates leads,
 * projects or outbound work; the existing human routing flow owns assignment. */
export async function ingestFacebookInboundBatch(
  tx: DatabaseTransaction,
  input: unknown,
  actorId: string,
  now = new Date(),
) {
  const batch = batchSchema.parse(input);
  const observed = Date.parse(batch.observedAt);
  if (observed > now.getTime() || now.getTime() - observed > 300000)
    throw new Error("inbound_observation_expired");
  for (const message of batch.messages) {
    const received = Date.parse(message.receivedAt);
    if (received > observed || now.getTime() - received >= 30 * 86400000)
      throw new Error("inbound_message_time_invalid");
  }
  // Serialize batches for this channel/account and operational pause changes.
  const [control] = await tx
    .select()
    .from(socialChannelControl)
    .where(
      and(
        eq(socialChannelControl.channelRef, batch.channelRef),
        eq(socialChannelControl.accountRef, batch.accountRef),
      ),
    )
    .for("update");
  if (!control?.enabled || control.circuitStatus !== "active")
    throw new Error("inbound_channel_inactive");
  let accepted = 0;
  let duplicates = 0;
  for (const message of batch.messages) {
    const receivedAt = new Date(message.receivedAt);
    await tx
      .insert(socialConversation)
      .values({
        id: randomUUID(),
        channelRef: batch.channelRef,
        accountRef: batch.accountRef,
        externalConversationRef: message.conversationRef,
        lastMessageAt: receivedAt,
      })
      .onConflictDoNothing({
        target: [
          socialConversation.channelRef,
          socialConversation.accountRef,
          socialConversation.externalConversationRef,
        ],
      });
    const [conversation] = await tx
      .select()
      .from(socialConversation)
      .where(
        and(
          eq(socialConversation.channelRef, batch.channelRef),
          eq(socialConversation.accountRef, batch.accountRef),
          eq(socialConversation.externalConversationRef, message.conversationRef),
        ),
      )
      .for("update");
    if (!conversation) throw new Error("inbound_conversation_missing");
    const [existing] = await tx
      .select()
      .from(socialMessage)
      .where(
        and(
          eq(socialMessage.conversationId, conversation.id),
          eq(socialMessage.externalMessageRef, message.messageRef),
        ),
      )
      .for("update");
    if (existing) {
      // Retention tombstones are not rehydrated by polling old history.
      if (
        !existing.deletedAt &&
        existing.expiresAt > now &&
        (existing.direction !== "inbound" ||
          existing.identityQuality !== "dom_id" ||
          existing.receivedAt.getTime() !== receivedAt.getTime() ||
          decryptSocialMessageBody(existing.bodyCiphertext) !== message.body)
      )
        throw new Error("inbound_message_conflict");
      duplicates++;
      continue;
    }
    const record = createStoredSocialMessageRecord({
      id: randomUUID(),
      conversationId: conversation.id,
      externalMessageRef: message.messageRef,
      direction: "inbound",
      identityQuality: "dom_id",
      body: message.body,
      receivedAt,
    });
    await tx.insert(socialMessage).values(record);
    await tx
      .update(socialConversation)
      .set({
        lastMessageAt: sql`greatest(${socialConversation.lastMessageAt}, ${receivedAt})`,
        updatedAt: now,
      })
      .where(eq(socialConversation.id, conversation.id));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      actorType: "system",
      actorId,
      action: "social_inbound.received",
      subjectType: "social_message",
      subjectId: record.id,
      metadata: { conversation_id: conversation.id, transport: "controlled_browser_observation" },
      occurredAt: now,
    });
    accepted++;
  }
  return { accepted, duplicates };
}
