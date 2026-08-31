import assert from "node:assert/strict";

import { decryptSocialMessageBody } from "../lib/social/message-crypto";
import { createStoredSocialMessageRecord } from "../lib/social/message-record";

process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const record = createStoredSocialMessageRecord({
  id: "message-001",
  conversationId: "conversation-001",
  externalMessageRef: "dom-message-001",
  direction: "inbound",
  identityQuality: "dom_id",
  body: "Synthetic RFQ body",
  receivedAt: new Date("2026-08-31T00:00:00.000Z"),
});
assert.equal("body" in record, false);
assert.equal(decryptSocialMessageBody(record.bodyCiphertext), "Synthetic RFQ body");
assert.equal(record.expiresAt.toISOString(), "2026-09-30T00:00:00.000Z");
assert.throws(() => createStoredSocialMessageRecord({
  id: record.id,
  conversationId: record.conversationId,
  externalMessageRef: record.externalMessageRef,
  direction: record.direction,
  identityQuality: record.identityQuality,
  body: "",
  receivedAt: record.receivedAt,
}), /Too small/);
console.log("PASS social message encryption and 30-day retention boundary");
