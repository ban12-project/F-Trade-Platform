import { z } from "zod";

export const socialStopReasonSchema = z.enum([
  "security_checkpoint", "captcha", "two_factor_required", "login_lost",
  "egress_ip_mismatch", "page_structure_unknown", "external_result_unknown",
]);
export type SocialStopReason = z.infer<typeof socialStopReasonSchema>;

export type SocialChannelCircuitState = {
  channelRef: string;
  accountRef: string;
  status: "active" | "paused";
  stopReason: SocialStopReason | null;
  pausedAt: Date | null;
};

export type WorkerObservation = {
  channelRef: string;
  accountRef: string;
  stopReason?: SocialStopReason;
  externalEffectCertain: boolean;
};

/** Any safety signal or uncertain external effect fails closed and forbids retries. */
export function applyWorkerObservation(state: SocialChannelCircuitState, observation: WorkerObservation): SocialChannelCircuitState {
  if (state.channelRef !== observation.channelRef || state.accountRef !== observation.accountRef) {
    throw new Error("Worker observation does not match social channel state");
  }
  if (state.status === "paused") return state;
  const reason = observation.stopReason ?? (observation.externalEffectCertain ? undefined : "external_result_unknown");
  if (!reason) return state;
  return { ...state, status: "paused", stopReason: socialStopReasonSchema.parse(reason), pausedAt: new Date() };
}

/** A resumed channel requires an explicit human acknowledgement of the resolved stop reason. */
export function resumeSocialChannel(state: SocialChannelCircuitState, actorType: "human" | "agent" | "system", acknowledgementRef: string): SocialChannelCircuitState {
  if (actorType !== "human") throw new Error("Only a human can resume a paused social channel");
  if (!acknowledgementRef.trim()) throw new Error("Resuming a social channel requires an acknowledgement reference");
  return { ...state, status: "active", stopReason: null, pausedAt: null };
}
