import { and, eq, sql } from "drizzle-orm";

import { getDatabase, type Database } from "../db/client";
import { aggregateRecord, approval, auditEvent, workflowEvent } from "../db/schema";
import {
  assertTransition,
  type ApprovalDecision,
  type WorkflowEventInput,
} from "./transitions";

export interface PersistedTransition {
  state: string;
  version: number;
}

function toApprovalDecision(
  row: {
    id: string;
    aggregateId: string;
    gate: ApprovalDecision["gate"];
    status: "pending" | "approved" | "rejected";
    decidedByType: "agent" | "human" | "system" | null;
    decidedById: string | null;
    evidenceRef: string | null;
  } | undefined,
): ApprovalDecision | undefined {
  if (
    !row ||
    (row.status !== "approved" && row.status !== "rejected") ||
    row.decidedByType !== "human" ||
    !row.decidedById ||
    !row.evidenceRef
  ) {
    return undefined;
  }
  return {
    id: row.id,
    aggregateId: row.aggregateId,
    gate: row.gate,
    status: row.status,
    decidedByType: "human",
    decidedById: row.decidedById,
    evidenceRef: row.evidenceRef,
  };
}

/**
 * Applies one authorized state change atomically. The aggregate row is locked,
 * then its state, immutable workflow event, and audit event are committed in
 * the same database transaction. Callers must authenticate and authorize the
 * actor before invoking this service.
 */
export async function persistTransition(
  event: WorkflowEventInput,
  database: Database = getDatabase(),
): Promise<PersistedTransition> {
  return database.transaction(async (tx) => {
    const [aggregate] = await tx
      .select({
        id: aggregateRecord.id,
        type: aggregateRecord.type,
        state: aggregateRecord.state,
        version: aggregateRecord.version,
      })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, event.entityId), eq(aggregateRecord.type, event.entityType)))
      .for("update");
    if (!aggregate) throw new Error("Workflow transition rejected: aggregate not found");
    if (aggregate.state !== event.fromState) {
      throw new Error(
        `Workflow transition rejected: current state is ${aggregate.state}, not ${event.fromState}`,
      );
    }

    const [approvalRow] = event.approvalRef
      ? await tx
          .select({
            id: approval.id,
            aggregateId: approval.aggregateId,
            gate: approval.gate,
            status: approval.status,
            decidedByType: approval.decidedByType,
            decidedById: approval.decidedById,
            evidenceRef: approval.evidenceRef,
          })
          .from(approval)
          .where(eq(approval.id, event.approvalRef))
          .for("update")
      : [];
    assertTransition(event, toApprovalDecision(approvalRow));

    const [updated] = await tx
      .update(aggregateRecord)
      .set({ state: event.toState, version: sql`${aggregateRecord.version} + 1` })
      .where(and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version)))
      .returning({ state: aggregateRecord.state, version: aggregateRecord.version });
    if (!updated) throw new Error("Workflow transition rejected: concurrent aggregate update");

    await tx.insert(workflowEvent).values({
      id: event.eventId,
      aggregateId: event.entityId,
      fromState: event.fromState,
      toState: event.toState,
      actorType: event.actorType,
      actorId: event.actorId,
      gate: event.gate,
      approvalId: event.approvalRef,
      evidenceRefs: event.evidenceRefs,
      occurredAt: new Date(event.occurredAt),
    });
    await tx.insert(auditEvent).values({
      id: `audit:${event.eventId}`,
      action: "workflow.transition",
      actorType: event.actorType,
      actorId: event.actorId,
      aggregateId: event.entityId,
      subjectType: "workflow_event",
      subjectId: event.eventId,
      metadata: {
        fromState: event.fromState,
        toState: event.toState,
        gate: event.gate ?? null,
        approvalRef: event.approvalRef ?? null,
        evidenceRefs: event.evidenceRefs,
      },
      occurredAt: new Date(event.occurredAt),
    });

    return updated;
  });
}
