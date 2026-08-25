export type AggregateType =
  | "product"
  | "content"
  | "rfq"
  | "quotation"
  | "lead"
  | "delivery_confirmation";

export type ActorType = "agent" | "human" | "system";
export type HumanGate = "gate_01_truth" | "gate_02_quote" | "gate_03_delivery";

export interface WorkflowEventInput {
  eventId: string;
  entityType: AggregateType;
  entityId: string;
  fromState: string;
  toState: string;
  actorType: ActorType;
  actorId: string;
  occurredAt: string;
  evidenceRefs: string[];
  gate?: HumanGate;
  approvalRef?: string;
}

export interface ApprovalDecision {
  id: string;
  aggregateId: string;
  gate: HumanGate;
  status: "approved" | "rejected";
  decidedByType: "human";
  decidedById: string;
  evidenceRef: string;
}

interface TransitionRule {
  entityType: AggregateType;
  fromState: string;
  toState: string;
  actors: readonly ActorType[];
  gate?: HumanGate;
  approvalStatus?: ApprovalDecision["status"];
}

const rules: readonly TransitionRule[] = [
  { entityType: "product", fromState: "PRODUCT_IMPORTED", toState: "PRODUCT_REVIEW_REQUIRED", actors: ["agent", "human", "system"] },
  { entityType: "product", fromState: "PRODUCT_REVIEW_REQUIRED", toState: "PRODUCT_READY", actors: ["human"], gate: "gate_01_truth", approvalStatus: "approved" },
  { entityType: "product", fromState: "PRODUCT_REVIEW_REQUIRED", toState: "PRODUCT_REVISION_REQUIRED", actors: ["human"], gate: "gate_01_truth", approvalStatus: "rejected" },
  { entityType: "product", fromState: "PRODUCT_REVISION_REQUIRED", toState: "PRODUCT_REVIEW_REQUIRED", actors: ["agent", "human", "system"] },
  { entityType: "content", fromState: "CONTENT_GENERATING", toState: "CONTENT_REVIEW_REQUIRED", actors: ["agent", "human"] },
  { entityType: "content", fromState: "CONTENT_REVIEW_REQUIRED", toState: "CONTENT_APPROVED", actors: ["human"], gate: "gate_01_truth", approvalStatus: "approved" },
  { entityType: "content", fromState: "CONTENT_REVIEW_REQUIRED", toState: "CONTENT_REVISION_REQUIRED", actors: ["human"], gate: "gate_01_truth", approvalStatus: "rejected" },
  { entityType: "content", fromState: "CONTENT_REVISION_REQUIRED", toState: "CONTENT_REVIEW_REQUIRED", actors: ["agent", "human"] },
  { entityType: "content", fromState: "CONTENT_APPROVED", toState: "CONTENT_PUBLISHED", actors: ["human", "system"] },
  { entityType: "rfq", fromState: "RFQ_COLLECTING", toState: "RFQ_READY", actors: ["agent", "human"] },
  { entityType: "quotation", fromState: "QUOTE_DRAFT", toState: "QUOTE_REVIEW_REQUIRED", actors: ["human"] },
  { entityType: "quotation", fromState: "QUOTE_REVIEW_REQUIRED", toState: "QUOTE_APPROVED", actors: ["human"], gate: "gate_02_quote", approvalStatus: "approved" },
  { entityType: "quotation", fromState: "QUOTE_REVIEW_REQUIRED", toState: "QUOTE_REVISION_REQUIRED", actors: ["human"], gate: "gate_02_quote", approvalStatus: "rejected" },
  { entityType: "quotation", fromState: "QUOTE_REVISION_REQUIRED", toState: "QUOTE_REVIEW_REQUIRED", actors: ["human"] },
  { entityType: "quotation", fromState: "QUOTE_APPROVED", toState: "QUOTE_SENT", actors: ["human", "system"] },
  { entityType: "lead", fromState: "LEAD_RECEIVED", toState: "FOLLOW_UP", actors: ["agent", "human", "system"] },
  { entityType: "lead", fromState: "FOLLOW_UP", toState: "OPPORTUNITY", actors: ["agent", "human"] },
  { entityType: "lead", fromState: "OPPORTUNITY", toState: "WON", actors: ["human"] },
  { entityType: "lead", fromState: "OPPORTUNITY", toState: "LOST", actors: ["human"] },
  { entityType: "delivery_confirmation", fromState: "DELIVERY_CONFIRMATION_PENDING", toState: "DELIVERY_CONFIRMATION_CONFIRMED", actors: ["human"], gate: "gate_03_delivery", approvalStatus: "approved" },
  { entityType: "delivery_confirmation", fromState: "DELIVERY_CONFIRMATION_PENDING", toState: "DELIVERY_CONFIRMATION_REJECTED", actors: ["human"], gate: "gate_03_delivery", approvalStatus: "rejected" },
  { entityType: "delivery_confirmation", fromState: "DELIVERY_CONFIRMATION_PENDING", toState: "DELIVERY_CONFIRMATION_EXPIRED", actors: ["system"] },
];

function fail(message: string): never {
  throw new Error(`Workflow transition rejected: ${message}`);
}

function assertNonEmpty(value: string, name: string) {
  if (!value.trim()) fail(`${name} must not be empty`);
}

export function assertTransition(
  event: WorkflowEventInput,
  approval?: ApprovalDecision,
): void {
  assertNonEmpty(event.eventId, "eventId");
  assertNonEmpty(event.entityId, "entityId");
  assertNonEmpty(event.actorId, "actorId");
  if (Number.isNaN(Date.parse(event.occurredAt))) fail("occurredAt must be an ISO date-time");
  if (!event.evidenceRefs.length) fail("evidenceRefs must include at least one reference");
  if (new Set(event.evidenceRefs).size !== event.evidenceRefs.length) fail("evidenceRefs must be unique");
  if (event.fromState === event.toState) fail("fromState and toState must differ");

  const rule = rules.find(
    (candidate) =>
      candidate.entityType === event.entityType &&
      candidate.fromState === event.fromState &&
      candidate.toState === event.toState,
  );
  if (!rule) fail(`${event.entityType} cannot move from ${event.fromState} to ${event.toState}`);
  if (!rule.actors.includes(event.actorType)) fail(`${event.actorType} cannot perform this transition`);

  if (!rule.gate) {
    if (event.gate || event.approvalRef || approval) fail("this transition must not carry a Human Gate approval");
    return;
  }

  if (event.gate !== rule.gate || !event.approvalRef || !approval) {
    fail(`this transition requires ${rule.gate} approval`);
  }
  if (
    approval.id !== event.approvalRef ||
    approval.aggregateId !== event.entityId ||
    approval.gate !== rule.gate ||
    approval.status !== rule.approvalStatus
  ) {
    fail("approval does not authorize this transition");
  }
  if (
    approval.decidedByType !== "human" ||
    approval.decidedById !== event.actorId ||
    !approval.evidenceRef.trim()
  ) {
    fail("approval must be a human decision by the transition actor with evidence");
  }
}

/** Rebuild an aggregate state from its immutable, chronologically ordered event stream. */
export function replayTransitions(
  entityType: AggregateType,
  entityId: string,
  initialState: string,
  entries: ReadonlyArray<{ event: WorkflowEventInput; approval?: ApprovalDecision }>,
): string {
  let state = initialState;
  let previousTime = -Infinity;
  const eventIds = new Set<string>();

  for (const { event, approval } of entries) {
    if (event.entityType !== entityType || event.entityId !== entityId) {
      fail("event belongs to a different aggregate");
    }
    if (eventIds.has(event.eventId)) fail(`event ${event.eventId} is duplicated`);
    eventIds.add(event.eventId);
    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt < previousTime) fail("events must be ordered by occurredAt");
    previousTime = occurredAt;
    if (event.fromState !== state) fail(`event ${event.eventId} expected ${state}, received ${event.fromState}`);
    assertTransition(event, approval);
    state = event.toState;
  }

  return state;
}
