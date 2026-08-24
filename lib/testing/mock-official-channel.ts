import {
  processOfficialInboundDelivery,
  type InboundDeliveryReceipt,
  type InboundDeliveryReceiptStore,
  type InboundDeliveryTransactionRunner,
} from "../social/inbound-delivery-store";
import type { ChannelInboundPolicy, OfficialInboundWebhook } from "../social/inbound-policy";

const policy: ChannelInboundPolicy = {
  channelRef: "synthetic-official-channel",
  accountRef: "synthetic-account",
  officialApi: true,
  inboundOnly: true,
  replyWindowMinutes: 60,
  outsideWindowAction: "block",
};

interface MockChannelState {
  deliveryKeys: Set<string>;
  acceptedActionCount: number;
}

interface MockChannelContext extends MockChannelState {}

export interface MockChannelResult {
  status: "accepted" | "duplicate" | "rejected";
  nextAction: "create_or_update_lead" | "ignore_duplicate" | "none";
  acceptedActionCount: number;
  reason?: "synthetic_downstream_failure";
}

function cloneState(state: MockChannelState): MockChannelContext {
  return {
    deliveryKeys: new Set(state.deliveryKeys),
    acceptedActionCount: state.acceptedActionCount,
  };
}

function receiptStore(context: MockChannelContext): InboundDeliveryReceiptStore {
  return {
    async claim(receipt: InboundDeliveryReceipt) {
      if (context.deliveryKeys.has(receipt.deliveryKey)) return "duplicate";
      context.deliveryKeys.add(receipt.deliveryKey);
      return "accepted";
    },
  };
}

/**
 * A test-only stand-in for an official inbound channel. It handles metadata
 * only; no message body, credentials, or real channel request is accepted.
 */
export class MockOfficialChannelServer {
  private state: MockChannelState = { deliveryKeys: new Set(), acceptedActionCount: 0 };

  reset() {
    this.state = { deliveryKeys: new Set(), acceptedActionCount: 0 };
    return this.snapshot("accepted", "none");
  }

  async deliver(messageId: string, options: { failDownstream?: boolean } = {}): Promise<MockChannelResult> {
    const runner: InboundDeliveryTransactionRunner<MockChannelContext> = {
      transaction: async <Result>(callback: (context: MockChannelContext) => Promise<Result>) => {
        const transactionState = cloneState(this.state);
        const result = await callback(transactionState);
        this.state = transactionState;
        return result;
      },
    };
    const webhook: OfficialInboundWebhook = {
      transport: "official_webhook",
      channelRef: policy.channelRef,
      accountRef: policy.accountRef,
      messageId,
      direction: "inbound",
      receivedAt: "2026-08-25T00:00:00.000Z",
    };

    try {
      const result = await processOfficialInboundDelivery(
        policy,
        webhook,
        runner,
        receiptStore,
        async (context) => {
          if (options.failDownstream) throw new Error("synthetic downstream failure");
          context.acceptedActionCount += 1;
          return context.acceptedActionCount;
        },
      );
      return this.snapshot(result.status, result.nextAction);
    } catch (error) {
      if (error instanceof Error && error.message === "synthetic downstream failure") {
        return this.snapshot("rejected", "none", "synthetic_downstream_failure");
      }
      throw error;
    }
  }

  private snapshot(
    status: MockChannelResult["status"],
    nextAction: MockChannelResult["nextAction"],
    reason?: MockChannelResult["reason"],
  ): MockChannelResult {
    return { status, nextAction, acceptedActionCount: this.state.acceptedActionCount, reason };
  }
}
