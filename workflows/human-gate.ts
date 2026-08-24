import { defineHook } from "workflow";

export type HumanGate = "gate_01_truth" | "gate_02_quote" | "gate_03_delivery";

export interface HumanGateWorkflowInput {
  approvalId: string;
  aggregateId: string;
  gate: HumanGate;
}

export interface HumanGateDecision {
  status: "approved" | "rejected";
  actorType: "human";
  actorId: string;
  evidenceRef: string;
  decidedAt: string;
  notes?: string;
}

export type HumanGateWorkflowResult =
  | { status: "decided"; decision: HumanGateDecision }
  | { status: "duplicate"; ownerRunId: string };

const humanGateDecisionHook = defineHook<HumanGateDecision>();

export function humanGateToken(approvalId: string) {
  if (!approvalId.trim()) throw new Error("approvalId must not be empty");
  return `f-trade:human-gate:${approvalId}`;
}

function assertHumanGateDecision(value: HumanGateDecision) {
  if (value.actorType !== "human") {
    throw new Error("Human Gate decisions require a human actor");
  }
  if (!value.actorId.trim() || !value.evidenceRef.trim()) {
    throw new Error("Human Gate decisions require actor and evidence references");
  }
  if (Number.isNaN(Date.parse(value.decidedAt))) {
    throw new Error("Human Gate decision time must be an ISO date-time");
  }
}

export async function waitForHumanGate(
  input: HumanGateWorkflowInput,
): Promise<HumanGateWorkflowResult> {
  "use workflow";

  const hook = humanGateDecisionHook.create({
    token: humanGateToken(input.approvalId),
    metadata: {
      approvalId: input.approvalId,
      aggregateId: input.aggregateId,
      gate: input.gate,
    },
  });
  const conflict = await hook.getConflict();
  if (conflict) return { status: "duplicate", ownerRunId: conflict.runId };

  const decision = await hook;
  assertHumanGateDecision(decision);
  return { status: "decided", decision };
}
