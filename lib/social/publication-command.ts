import { z } from "zod";

import { validatePublicationPolicy, type ContentPublicationPolicy } from "../content/publication-policy";
import type { SocialChannelCircuitState } from "./circuit-breaker";

export const controlledPublicationRequestSchema = z.object({
  publicationId: z.string().trim().min(1).max(240),
  contentRef: z.string().trim().min(1).max(240),
  format: z.enum(["text", "image", "video"]),
  humanConfirmationRef: z.string().trim().min(1).max(240),
  confirmedBy: z.literal("human"),
}).strict();
export type ControlledPublicationRequest = z.infer<typeof controlledPublicationRequestSchema>;

/** Creates a Worker-safe payload only after Gate 01, per-post confirmation and circuit checks. */
export function createControlledPublicationCommand(
  content: Record<string, unknown>,
  policy: ContentPublicationPolicy,
  circuit: SocialChannelCircuitState,
  request: ControlledPublicationRequest,
) {
  validatePublicationPolicy(policy);
  const parsed = controlledPublicationRequestSchema.parse(request);
  if (policy.transport !== "camofox_controlled_mvp1") throw new Error("Controlled publication command requires the CamoFox MVP1 transport");
  if (circuit.status !== "active") throw new Error("Social channel is paused and cannot publish");
  if (circuit.channelRef !== policy.channelRef || circuit.accountRef !== policy.accountRef) throw new Error("Circuit state does not match publication policy");
  if (content.status !== "approved" || typeof content.approval_ref !== "string" || !content.approval_ref.trim()) {
    throw new Error("Controlled publication requires Gate 01 approved content");
  }
  return {
    jobKind: "publish" as const,
    publicationId: parsed.publicationId,
    channelRef: policy.channelRef,
    accountRef: policy.accountRef,
    contentRef: parsed.contentRef,
    format: parsed.format,
    gate01ApprovalRef: content.approval_ref,
    humanConfirmationRef: parsed.humanConfirmationRef,
  };
}
