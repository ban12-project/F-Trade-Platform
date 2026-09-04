import { eq } from "drizzle-orm";

import { type Database, getDatabase } from "../db/client";
import { socialInboundDelivery } from "../db/schema";
import {
  type ChannelInboundPolicy,
  inboundDeliveryKey,
  type OfficialInboundWebhook,
  validateOfficialInboundWebhook,
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

export interface InboundDeliveryTransactionRunner<Context> {
  transaction<T>(callback: (context: Context) => Promise<T>): Promise<T>;
}

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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
    nextAction:
      status === "accepted" ? ("create_or_update_lead" as const) : ("ignore_duplicate" as const),
  };
}

/**
 * Claims a delivery and runs the accepted action inside the caller's database
 * transaction. A duplicate never reaches the action. If the action throws,
 * the transaction runner must roll the claim back with the action.
 */
export async function processOfficialInboundDelivery<Context, Result>(
  policy: ChannelInboundPolicy,
  webhook: OfficialInboundWebhook,
  runner: InboundDeliveryTransactionRunner<Context>,
  storeForContext: (context: Context) => InboundDeliveryReceiptStore,
  onAccepted: (context: Context, receipt: InboundDeliveryReceipt) => Promise<Result>,
) {
  const receipt = createInboundDeliveryReceipt(policy, webhook);
  return runner.transaction(async (context) => {
    const status = await storeForContext(context).claim(receipt);
    if (status === "duplicate") {
      return {
        deliveryKey: receipt.deliveryKey,
        status,
        nextAction: "ignore_duplicate" as const,
      };
    }
    const result = await onAccepted(context, receipt);
    return {
      deliveryKey: receipt.deliveryKey,
      status,
      nextAction: "create_or_update_lead" as const,
      result,
    };
  });
}

/** Uses a unique database index as the concurrency-safe delivery claim. */
export function databaseInboundDeliveryReceiptStore(
  database: Pick<Database, "insert"> = getDatabase(),
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

export async function processDatabaseOfficialInboundDelivery<Result>(
  policy: ChannelInboundPolicy,
  webhook: OfficialInboundWebhook,
  onAccepted: (
    transaction: DatabaseTransaction,
    receipt: InboundDeliveryReceipt,
  ) => Promise<Result>,
  database: Database = getDatabase(),
) {
  return processOfficialInboundDelivery(
    policy,
    webhook,
    database,
    (transaction) => databaseInboundDeliveryReceiptStore(transaction),
    onAccepted,
  );
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
