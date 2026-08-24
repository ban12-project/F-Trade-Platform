import type { InferInsertModel } from "drizzle-orm";

import { getDatabase } from "../db/client";
import { auditEvent, workflowEvent } from "../db/schema";

type NewAuditEvent = InferInsertModel<typeof auditEvent>;
type NewWorkflowEvent = InferInsertModel<typeof workflowEvent>;

function assertActor(actorId: string) {
  if (!actorId.trim()) {
    throw new Error("Audit actorId must not be empty");
  }
}

export async function appendAuditEvent(event: NewAuditEvent) {
  assertActor(event.actorId);
  await getDatabase().insert(auditEvent).values(event);
}

export async function appendWorkflowEvent(event: NewWorkflowEvent) {
  assertActor(event.actorId);
  await getDatabase().insert(workflowEvent).values(event);
}
