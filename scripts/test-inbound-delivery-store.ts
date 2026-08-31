import assert from "node:assert/strict";

import {
  claimOfficialInboundDelivery,
  createInboundDeliveryReceipt,
  processOfficialInboundDelivery,
  type InboundDeliveryReceipt,
  type InboundDeliveryReceiptStore,
  type InboundDeliveryTransactionRunner,
} from "../lib/social/inbound-delivery-store";

class InMemoryAtomicReceiptStore implements InboundDeliveryReceiptStore {
  private readonly receiptKeys = new Set<string>();

  async claim(receipt: InboundDeliveryReceipt) {
    if (this.receiptKeys.has(receipt.deliveryKey)) return "duplicate" as const;
    this.receiptKeys.add(receipt.deliveryKey);
    return "accepted" as const;
  }
}

class TransactionalInMemoryReceiptStore implements InboundDeliveryTransactionRunner<Set<string>> {
  private readonly committedKeys = new Set<string>();

  async transaction<T>(callback: (keys: Set<string>) => Promise<T>) {
    const pendingKeys = new Set(this.committedKeys);
    const result = await callback(pendingKeys);
    this.committedKeys.clear();
    for (const key of pendingKeys) this.committedKeys.add(key);
    return result;
  }

  storeFor(keys: Set<string>): InboundDeliveryReceiptStore {
    return {
      async claim(receipt) {
        if (keys.has(receipt.deliveryKey)) return "duplicate" as const;
        keys.add(receipt.deliveryKey);
        return "accepted" as const;
      },
    };
  }
}

const policy = {
  channelRef: "synthetic-facebook-channel",
  accountRef: "synthetic-factory-account",
  transport: "official_api" as const,
  inboundOnly: true,
  replyWindowMinutes: 60,
  outsideWindowAction: "require_approved_template" as const,
};
const webhook = {
  transport: "official_webhook" as const,
  channelRef: policy.channelRef,
  accountRef: policy.accountRef,
  messageId: "synthetic-platform-message-001",
  direction: "inbound" as const,
  receivedAt: "2026-08-24T09:00:00Z",
};

async function main() {
  const store = new InMemoryAtomicReceiptStore();
  const receipt = createInboundDeliveryReceipt(policy, webhook);
  assert.deepEqual(receipt, {
    deliveryKey: "synthetic-facebook-channel:synthetic-factory-account:synthetic-platform-message-001",
    channelRef: policy.channelRef,
    accountRef: policy.accountRef,
    messageId: webhook.messageId,
    receivedAt: webhook.receivedAt,
  });
  assert.deepEqual(await claimOfficialInboundDelivery(policy, webhook, store), {
    deliveryKey: receipt.deliveryKey,
    status: "accepted",
    nextAction: "create_or_update_lead",
  });
  assert.deepEqual(await claimOfficialInboundDelivery(policy, webhook, store), {
    deliveryKey: receipt.deliveryKey,
    status: "duplicate",
    nextAction: "ignore_duplicate",
  });
  assert.throws(
    () => createInboundDeliveryReceipt(policy, { ...webhook, accountRef: "synthetic-wrong-account" }),
    /must match/,
  );
  const transactionalStore = new TransactionalInMemoryReceiptStore();
  assert.deepEqual(
    await processOfficialInboundDelivery(
      policy,
      webhook,
      transactionalStore,
      (keys) => transactionalStore.storeFor(keys),
      async (_context, acceptedReceipt) => ({ leadAction: acceptedReceipt.messageId }),
    ),
    {
      deliveryKey: receipt.deliveryKey,
      status: "accepted",
      nextAction: "create_or_update_lead",
      result: { leadAction: webhook.messageId },
    },
  );
  assert.deepEqual(
    await processOfficialInboundDelivery(
      policy,
      webhook,
      transactionalStore,
      (keys) => transactionalStore.storeFor(keys),
      async () => ({ shouldNotRun: true }),
    ),
    {
      deliveryKey: receipt.deliveryKey,
      status: "duplicate",
      nextAction: "ignore_duplicate",
    },
  );
  const failingWebhook = { ...webhook, messageId: "synthetic-platform-message-rollback" };
  await assert.rejects(
    processOfficialInboundDelivery(
      policy,
      failingWebhook,
      transactionalStore,
      (keys) => transactionalStore.storeFor(keys),
      async () => { throw new Error("lead action failed"); },
    ),
    /lead action failed/,
  );
  assert.equal(
    (await processOfficialInboundDelivery(
      policy,
      failingWebhook,
      transactionalStore,
      (keys) => transactionalStore.storeFor(keys),
      async () => "retried",
    )).status,
    "accepted",
  );
  console.log("PASS durable inbound delivery receipt boundary");
}

void main();
