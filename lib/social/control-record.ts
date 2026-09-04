import { z } from "zod";

export const socialControlChangeSchema = z
  .object({
    channelRef: z.string().trim().min(1).max(240),
    accountRef: z.string().trim().min(1).max(240),
    action: z.enum(["enable", "pause", "resume"]),
    actorType: z.literal("human"),
    actorId: z.string().trim().min(1).max(240),
    evidenceRef: z.string().trim().min(1).max(240),
  })
  .strict();

export type SocialControlRecord = {
  enabled: boolean;
  circuitStatus: "active" | "paused";
  pauseReason: string | null;
  pauseEvidenceRef: string | null;
};

/** Derives the fail-closed database update; every state change needs a human and evidence. */
export function applySocialControlChange(
  current: SocialControlRecord,
  input: z.infer<typeof socialControlChangeSchema>,
): SocialControlRecord {
  const parsed = socialControlChangeSchema.parse(input);
  if (parsed.action === "enable" || parsed.action === "resume") {
    return { enabled: true, circuitStatus: "active", pauseReason: null, pauseEvidenceRef: null };
  }
  return {
    enabled: false,
    circuitStatus: "paused",
    pauseReason: "manual_pause",
    pauseEvidenceRef: parsed.evidenceRef,
  };
}
