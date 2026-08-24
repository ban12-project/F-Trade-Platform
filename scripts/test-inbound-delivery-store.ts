import assert from "node:assert/strict";

import {
  claimOfficialInboundDelivery,
  createInboundDeliveryReceipt,
  type InboundDeliveryReceipt,
  type InboundDeliveryReceiptStore,
} from "../lib/social/inbound-delivery-store";

class InMemoryAtomicReceiptStore implements InboundDeliveryReceiptStore {
  private readonly receiptKeys = new Set<string>();

  async claim(receipt: InboundDeliveryReceipt) {
    if (this.receiptKeys.has(receipt.deliveryKey)) return "duplicate" as const;
    this.receiptKeys.add(receipt.deliveryKey);
    return "accepted" as const;
  }
}

const policy = {
  channelRef: "synthetic-instagram-channel",
  accountRef: "synthetic-factory-account",
  officialApi: true,
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
    deliveryKey: "synthetic-instagram-channel:synthetic-factory-account:synthetic-platform-message-001",
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
  console.log("PASS durable inbound delivery receipt boundary");
}

void main();
