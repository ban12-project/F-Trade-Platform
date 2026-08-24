import assert from "node:assert/strict";

import {
  assessInboundDelivery,
  assessReplyWindow,
  acceptOfficialInboundWebhook,
  inboundDeliveryKey,
  validateChannelInboundPolicy,
} from "../lib/social/inbound-policy";

const policy = {
  channelRef: "synthetic-instagram-channel",
  accountRef: "synthetic-factory-account",
  officialApi: true,
  inboundOnly: true,
  replyWindowMinutes: 60,
  outsideWindowAction: "require_approved_template" as const,
};
const message = {
  messageId: "synthetic-platform-message-001",
  direction: "inbound" as const,
  receivedAt: "2026-08-24T09:00:00Z",
};

const key = inboundDeliveryKey(policy, message);
const webhook = {
  transport: "official_webhook" as const,
  channelRef: policy.channelRef,
  accountRef: policy.accountRef,
  ...message,
};
assert.equal(acceptOfficialInboundWebhook(policy, webhook, new Set()).status, "accepted");
assert.equal(assessInboundDelivery(policy, message, new Set()).status, "accepted");
assert.deepEqual(assessInboundDelivery(policy, message, new Set([key])), {
  deliveryKey: key,
  status: "duplicate",
  nextAction: "ignore_duplicate",
});
assert.deepEqual(assessReplyWindow(policy, message, "2026-08-24T10:00:00Z"), {
  status: "within_window",
  automatedReplyAllowed: true,
  nextAction: "reply_per_channel_policy",
});
assert.deepEqual(assessReplyWindow(policy, message, "2026-08-24T10:00:01Z"), {
  status: "outside_window",
  automatedReplyAllowed: false,
  nextAction: "require_human_approved_template",
});
assert.throws(() => inboundDeliveryKey(policy, { ...message, direction: "outbound" }), /Only inbound/);
assert.throws(() => acceptOfficialInboundWebhook(policy, { ...webhook, transport: "browser_dom" as "official_webhook" }, new Set()), /official webhook/);
assert.throws(() => acceptOfficialInboundWebhook(policy, { ...webhook, accountRef: "synthetic-other-account" }, new Set()), /must match/);
assert.throws(() => validateChannelInboundPolicy({ ...policy, officialApi: false }), /official API/);
assert.throws(() => validateChannelInboundPolicy({ ...policy, inboundOnly: false }), /inbound-only/);
assert.throws(() => assessReplyWindow(policy, message, "2026-08-24T08:59:59Z"), /cannot precede/);

console.log("PASS social inbound policy");
