import assert from "node:assert/strict";
import { createBoundedRfqReply } from "../lib/social/rfq-reply-policy";

const policy = { channelRef: "social-facebook", accountRef: "account-001", transport: "camofox_controlled_mvp1" as const, inboundOnly: true, replyWindowMinutes: 60, outsideWindowAction: "block" as const };
const inbound = { messageId: "message-001", direction: "inbound" as const, receivedAt: "2026-08-31T00:00:00.000Z" };
assert.equal(createBoundedRfqReply(policy, inbound, "2026-08-31T00:30:00.000Z", "quantity").templateId, "rfq_missing_quantity");
assert.throws(() => createBoundedRfqReply(policy, inbound, "2026-08-31T00:30:00.000Z", "price"), /human handling/);
assert.throws(() => createBoundedRfqReply(policy, inbound, "2026-08-31T02:00:00.000Z", "quantity"), /outside/);
console.log("PASS bounded RFQ replies only request approved missing fields within window");
