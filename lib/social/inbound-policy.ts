export interface ChannelInboundPolicy {
  channelRef: string;
  accountRef: string;
  officialApi: boolean;
  inboundOnly: boolean;
  replyWindowMinutes: number;
  outsideWindowAction: "block" | "require_approved_template";
}

export interface InboundMessageReference {
  messageId: string;
  direction: "inbound" | "outbound";
  receivedAt: string;
}

export interface OfficialInboundWebhook {
  transport: "official_webhook";
  channelRef: string;
  accountRef: string;
  messageId: string;
  direction: "inbound";
  receivedAt: string;
}

function requireReference(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required`);
}

function parseTime(value: string, label: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return time;
}

export function validateChannelInboundPolicy(policy: ChannelInboundPolicy) {
  requireReference(policy.channelRef, "Channel reference");
  requireReference(policy.accountRef, "Account reference");
  if (policy.officialApi !== true) throw new Error("Inbound policy requires an official API channel");
  if (policy.inboundOnly !== true) throw new Error("Inbound policy must remain inbound-only");
  if (!Number.isInteger(policy.replyWindowMinutes) || policy.replyWindowMinutes < 1) {
    throw new Error("Reply window must be a positive whole number of minutes");
  }
  return policy;
}

export function inboundDeliveryKey(policy: ChannelInboundPolicy, message: InboundMessageReference) {
  validateChannelInboundPolicy(policy);
  requireReference(message.messageId, "External message ID");
  if (message.direction !== "inbound") throw new Error("Only inbound messages may enter the social workflow");
  parseTime(message.receivedAt, "Inbound received time");
  return `${policy.channelRef}:${policy.accountRef}:${message.messageId}`;
}

export function assessInboundDelivery(
  policy: ChannelInboundPolicy,
  message: InboundMessageReference,
  processedDeliveryKeys: ReadonlySet<string>,
) {
  const deliveryKey = inboundDeliveryKey(policy, message);
  return {
    deliveryKey,
    status: processedDeliveryKeys.has(deliveryKey) ? "duplicate" as const : "accepted" as const,
    nextAction: processedDeliveryKeys.has(deliveryKey) ? "ignore_duplicate" as const : "create_or_update_lead" as const,
  };
}

export function acceptOfficialInboundWebhook(
  policy: ChannelInboundPolicy,
  webhook: OfficialInboundWebhook,
  processedDeliveryKeys: ReadonlySet<string>,
) {
  validateChannelInboundPolicy(policy);
  if (webhook.transport !== "official_webhook") {
    throw new Error("Inbound workflow accepts only official webhook transport");
  }
  if (webhook.channelRef !== policy.channelRef || webhook.accountRef !== policy.accountRef) {
    throw new Error("Official webhook channel and account must match the inbound policy");
  }
  return assessInboundDelivery(policy, webhook, processedDeliveryKeys);
}

export function assessReplyWindow(
  policy: ChannelInboundPolicy,
  message: InboundMessageReference,
  now: string,
) {
  inboundDeliveryKey(policy, message);
  const receivedAt = parseTime(message.receivedAt, "Inbound received time");
  const evaluatedAt = parseTime(now, "Reply evaluation time");
  if (evaluatedAt < receivedAt) throw new Error("Reply evaluation time cannot precede inbound receipt");
  const withinWindow = evaluatedAt - receivedAt <= policy.replyWindowMinutes * 60_000;
  if (withinWindow) {
    return { status: "within_window" as const, automatedReplyAllowed: true, nextAction: "reply_per_channel_policy" as const };
  }
  return policy.outsideWindowAction === "block"
    ? { status: "outside_window" as const, automatedReplyAllowed: false, nextAction: "block_and_escalate_human" as const }
    : { status: "outside_window" as const, automatedReplyAllowed: false, nextAction: "require_human_approved_template" as const };
}
