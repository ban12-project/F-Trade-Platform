import { randomUUID } from "node:crypto";
import { inboxSignature } from "../../lib/browser-fleet/inbox-signature.mjs";

/** Holds only this lease's derived key; adapters receive the callback, not keys. */
export function createInboxReporter({ run, request, assertActive, checkEgress }) {
  const { id: runId, leaseId, inboxSigningKey } = run;
  let pending;
  let failed = false;
  return async (messages, observedAt) => {
    if (failed || pending) throw new Error("inbox_reporter_unavailable");
    if (run.kind !== "inbox" || !inboxSigningKey) throw new Error("inbox_run_invalid");
    assertActive();
    if (!Array.isArray(messages) || !messages.length || messages.length > 20)
      throw new Error("inbox_messages_invalid");
    const packet = {
      runId,
      leaseId,
      requestId: randomUUID(),
      observedAt,
      messages: messages.map((message) => ({
        conversationRef: message.conversationRef,
        messageRef: message.messageRef,
        direction: message.direction,
        identityQuality: message.identityQuality,
        body: message.body,
        receivedAt: message.receivedAt,
      })),
    };
    const envelope = { packet, signature: inboxSignature(inboxSigningKey, packet) };
    if (Buffer.byteLength(JSON.stringify(envelope)) > 250000)
      throw new Error("inbox_messages_limit");
    pending = envelope;
    try {
      await checkEgress();
      assertActive();
      const result = await request("inbox-messages", { runId, leaseId, envelope });
      const receipt = result.receipt;
      if (
        !receipt ||
        !Number.isInteger(receipt.accepted) ||
        !Number.isInteger(receipt.duplicates) ||
        receipt.accepted < 0 ||
        receipt.duplicates < 0 ||
        receipt.accepted + receipt.duplicates !== messages.length
      )
        throw new Error("inbox_receipt_invalid");
      return receipt;
    } catch (error) {
      // Stop this polling run on ambiguity. A later poll deduplicates by message ID.
      failed = true;
      throw error;
    } finally {
      pending = null;
    }
  };
}
