import { compileContract } from "../contracts/validator";
import deliverySchema from "../../contracts/sales/delivery-confirmation.schema.json";

type Delivery = Record<string, unknown>;
const validateDelivery = compileContract<Delivery>(deliverySchema);

function nonEmpty(value: string, label: string) {
  if (!value.trim()) throw new Error(`Delivery confirmation requires ${label}`);
}

export function requestDeliveryConfirmation(input: {
  confirmationId: string;
  relatedEntityType: "rfq" | "opportunity";
  relatedEntityId: string;
  requestedByType: "agent" | "human" | "system";
  requestedById: string;
  requestedAt: string;
}) {
  nonEmpty(input.confirmationId, "confirmationId");
  nonEmpty(input.relatedEntityId, "relatedEntityId");
  nonEmpty(input.requestedById, "requestedById");
  if (Number.isNaN(Date.parse(input.requestedAt))) throw new Error("Delivery request requires an ISO date-time");
  return validateDelivery({
    confirmation_id: input.confirmationId,
    related_entity_type: input.relatedEntityType,
    related_entity_id: input.relatedEntityId,
    status: "pending",
    requested_by_type: input.requestedByType,
    requested_by_id: input.requestedById,
    requested_at: input.requestedAt,
  });
}

export function decideDeliveryConfirmation(
  pending: Delivery,
  decision: { actorType: "human" | "agent" | "system"; actorId: string; status: "confirmed" | "rejected"; approvalRef: string; evidenceRef: string; decidedAt: string; leadTimeDays?: number },
) {
  if (pending.status !== "pending") throw new Error("Only a pending delivery confirmation can be decided");
  if (decision.actorType !== "human") throw new Error("Gate 03 decisions require a human actor");
  for (const [label, value] of Object.entries({ actorId: decision.actorId, approvalRef: decision.approvalRef, evidenceRef: decision.evidenceRef })) nonEmpty(value, label);
  if (Number.isNaN(Date.parse(decision.decidedAt))) throw new Error("Gate 03 decisions require an ISO date-time");
  if (decision.status === "confirmed" && !Number.isInteger(decision.leadTimeDays)) throw new Error("A confirmed delivery requires a human-confirmed lead time");
  return validateDelivery({
    ...pending,
    status: decision.status,
    approval_ref: decision.approvalRef,
    result: {
      actor_type: "human", decided_by: decision.actorId, decided_at: decision.decidedAt,
      evidence_ref: decision.evidenceRef,
      ...(decision.status === "confirmed" ? { confirmed_lead_time_days: decision.leadTimeDays } : {}),
    },
  });
}

export function expireDeliveryConfirmation(pending: Delivery, actorType: "system" | "agent" | "human") {
  if (pending.status !== "pending") throw new Error("Only a pending delivery confirmation can expire");
  if (actorType !== "system") throw new Error("Only the system can expire a delivery confirmation");
  return validateDelivery({ ...pending, status: "expired" });
}
