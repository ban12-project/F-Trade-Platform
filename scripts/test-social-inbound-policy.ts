import assert from "node:assert/strict";

import {
  acceptInboundChannelEvent,
  acceptOfficialInboundWebhook,
  assessInboundDelivery,
  assessReplyWindow,
  inboundDeliveryKey,
  validateChannelInboundPolicy,
} from "../lib/social/inbound-policy";

const policy = {
  channelRef: "synthetic-facebook-channel",
  accountRef: "synthetic-factory-account",
  transport: "camofox_controlled_mvp1" as const,
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
const observation = {
  transport: "controlled_browser_observation" as const,
  channelRef: policy.channelRef,
  accountRef: policy.accountRef,
  observationRef: "synthetic-observation-001",
  messageIdentityQuality: "derived_fingerprint" as const,
  ...message,
};
assert.equal(acceptInboundChannelEvent(policy, observation, new Set()).status, "accepted");
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
assert.throws(
  () => inboundDeliveryKey(policy, { ...message, direction: "outbound" }),
  /Only inbound/,
);
assert.throws(
  () => acceptInboundChannelEvent(policy, { ...observation, observationRef: "" }, new Set()),
  /observation reference/,
);
assert.throws(
  () =>
    acceptInboundChannelEvent(
      policy,
      { ...observation, accountRef: "synthetic-other-account" },
      new Set(),
    ),
  /must match/,
);
assert.throws(
  () => validateChannelInboundPolicy({ ...policy, transport: "unapproved" as "official_api" }),
  /approved channel transport/,
);
assert.throws(
  () => validateChannelInboundPolicy({ ...policy, inboundOnly: false }),
  /inbound-only/,
);
assert.throws(() => assessReplyWindow(policy, message, "2026-08-24T08:59:59Z"), /cannot precede/);

const officialPolicy = { ...policy, transport: "official_api" as const };
const officialWebhook = { ...observation, transport: "official_webhook" as const };
assert.equal(
  acceptOfficialInboundWebhook(officialPolicy, officialWebhook, new Set()).status,
  "accepted",
);
assert.throws(
  () => acceptOfficialInboundWebhook(policy, officialWebhook, new Set()),
  /official API policy/,
);

console.log("PASS social inbound policy");
