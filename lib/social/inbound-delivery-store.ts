import { eq } from "drizzle-orm";

import { getDatabase, type Database } from "../db/client";
import { socialInboundDelivery } from "../db/schema";
import {
  inboundDeliveryKey,
  validateOfficialInboundWebhook,
  type ChannelInboundPolicy,
  type OfficialInboundWebhook,
} from "./inbound-policy";

export interface InboundDeliveryReceipt {
  deliveryKey: string;
  channelRef: string;
  accountRef: string;
  messageId: string;
  receivedAt: string;
}

export interface InboundDeliveryReceiptStore {
  claim(receipt: InboundDeliveryReceipt): Promise<"accepted" | "duplicate">;
}

export function createInboundDeliveryReceipt(
  policy: ChannelInboundPolicy,
  webhook: OfficialInboundWebhook,
): InboundDeliveryReceipt {
  const message = validateOfficialInboundWebhook(policy, webhook);
  return {
    deliveryKey: inboundDeliveryKey(policy, message),
    channelRef: policy.channelRef,
    accountRef: policy.accountRef,
    messageId: message.messageId,
    receivedAt: message.receivedAt,
  };
}

export async function claimOfficialInboundDelivery(
  policy: ChannelInboundPolicy,
  webhook: OfficialInboundWebhook,
  store: InboundDeliveryReceiptStore,
) {
  const receipt = createInboundDeliveryReceipt(policy, webhook);
  const status = await store.claim(receipt);
  return {
    deliveryKey: receipt.deliveryKey,
    status,
    nextAction: status === "accepted" ? "create_or_update_lead" as const : "ignore_duplicate" as const,
  };
}

/** Uses a unique database index as the concurrency-safe delivery claim. */
export function databaseInboundDeliveryReceiptStore(
  database: Database = getDatabase(),
): InboundDeliveryReceiptStore {
  return {
    async claim(receipt) {
      const inserted = await database
        .insert(socialInboundDelivery)
        .values({
          deliveryKey: receipt.deliveryKey,
          channelRef: receipt.channelRef,
          accountRef: receipt.accountRef,
          messageId: receipt.messageId,
          receivedAt: new Date(receipt.receivedAt),
        })
        .onConflictDoNothing({
          target: [
            socialInboundDelivery.channelRef,
            socialInboundDelivery.accountRef,
            socialInboundDelivery.messageId,
          ],
        })
        .returning({ deliveryKey: socialInboundDelivery.deliveryKey });
      return inserted.length === 1 ? "accepted" : "duplicate";
    },
  };
}

export async function hasInboundDeliveryReceipt(
  deliveryKey: string,
  database: Database = getDatabase(),
) {
  const [receipt] = await database
    .select({ deliveryKey: socialInboundDelivery.deliveryKey })
    .from(socialInboundDelivery)
    .where(eq(socialInboundDelivery.deliveryKey, deliveryKey));
  return Boolean(receipt);
}
