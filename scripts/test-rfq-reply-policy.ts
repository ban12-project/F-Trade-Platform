import assert from "node:assert/strict";
import { createBoundedRfqReply } from "../lib/social/rfq-reply-policy";

const policy = {
  channelRef: "social-facebook",
  accountRef: "account-001",
  transport: "camofox_controlled_mvp1" as const,
  inboundOnly: true,
  replyWindowMinutes: 60,
  outsideWindowAction: "block" as const,
};
const inbound = {
  messageId: "message-001",
  direction: "inbound" as const,
  receivedAt: "2026-08-31T00:00:00.000Z",
};
assert.equal(
  createBoundedRfqReply(policy, inbound, "2026-08-31T00:30:00.000Z", "quantity").templateId,
  "rfq_missing_quantity",
);
for (const field of [
  "price",
  "toString",
  "constructor",
  "__proto__",
  "hasOwnProperty",
  "valueOf",
  "",
  "Quantity",
]) {
  assert.throws(
    () => createBoundedRfqReply(policy, inbound, "2026-08-31T00:30:00.000Z", field),
    /human handling/,
    `Unsupported RFQ field ${field} must not select a template`,
  );
}
for (const field of ["product_type", "quantity", "destination"]) {
  const reply = createBoundedRfqReply(policy, inbound, "2026-08-31T00:30:00.000Z", field);
  assert.equal(reply.templateId, `rfq_missing_${field}`);
  assert.equal(typeof reply.body, "string");
  assert.ok(reply.body.startsWith("To prepare your RFQ, please share"));
}
assert.throws(
  () => createBoundedRfqReply(policy, inbound, "2026-08-31T02:00:00.000Z", "quantity"),
  /outside/,
);
console.log("PASS bounded RFQ replies only request approved missing fields within window");
