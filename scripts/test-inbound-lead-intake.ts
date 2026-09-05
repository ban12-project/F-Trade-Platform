import assert from "node:assert/strict";
import { createInboundLeadIntake } from "../lib/social/inbound-lead-intake";

const policy = {
  channelRef: "social-facebook",
  accountRef: "account-001",
  transport: "camofox_controlled_mvp1" as const,
  inboundOnly: true,
  replyWindowMinutes: 1440,
  outsideWindowAction: "block" as const,
};
const event = {
  transport: "controlled_browser_observation" as const,
  channelRef: policy.channelRef,
  accountRef: policy.accountRef,
  messageId: "dom-message-001",
  direction: "inbound" as const,
  receivedAt: "2026-08-31T00:00:00.000Z",
  observationRef: "observation-001",
  messageIdentityQuality: "dom_id" as const,
};
const intake = createInboundLeadIntake(policy, event, {
  conversationRef: "conversation-001",
  leadRef: "lead-001",
  messageRecordRef: "message-record-001",
  requestedProductType: "clutch kit",
});
assert.equal(intake.source, "passive_social_inbound");
assert.equal(intake.rfqCollection.productType, "clutch kit");
assert.equal("outboundMessage" in intake, false);
assert.throws(
  () =>
    createInboundLeadIntake(
      policy,
      { ...event, direction: "outbound" as "inbound" },
      {
        conversationRef: "conversation-001",
        leadRef: "lead-001",
        messageRecordRef: "message-record-001",
      },
    ),
  /Only inbound/,
);
console.log("PASS passive inbound observations create lead/RFQ intake only");
