import { publishContent } from "./gate";

export interface ContentPublicationPolicy {
  channelRef: string;
  accountRef: string;
  transport: "official_api" | "camofox_controlled_mvp1";
  publishingEnabled: boolean;
}

export function validatePublicationPolicy(policy: ContentPublicationPolicy) {
  if (!policy.channelRef.trim() || !policy.accountRef.trim()) {
    throw new Error("Publication policy requires channel and account references");
  }
  if (!['official_api', 'camofox_controlled_mvp1'].includes(policy.transport)) {
    throw new Error("Content publication requires an approved channel transport");
  }
  if (!policy.publishingEnabled) throw new Error("Content publication is not enabled for this channel");
  return policy;
}

export function publishThroughChannel(
  content: Record<string, unknown>,
  policy: ContentPublicationPolicy,
  actorType: "human" | "agent" | "system",
  publicationRef: string,
) {
  validatePublicationPolicy(policy);
  if (actorType === "agent") throw new Error("An agent cannot use a publication transport");
  if (!publicationRef.trim()) throw new Error("Publication requires an external publication reference");
  return publishContent(content, actorType, publicationRef);
}

export const publishThroughOfficialChannel = publishThroughChannel;
