import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import { workflowEvent, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";

/** Re-scope to the actor even when the candidate ids came from an authorized snapshot. */
export async function readHumanOpportunityIds(
  actorId: string,
  ids: string[],
  database: Database = getDatabase(),
) {
  if (!ids.length) return [];
  const events = await database
    .select({
      aggregateId: workflowEvent.aggregateId,
      actorId: workflowEvent.actorId,
      evidenceRefs: workflowEvent.evidenceRefs,
    })
    .from(workflowEvent)
    .innerJoin(
      workspaceProjectItem,
      eq(workspaceProjectItem.aggregateId, workflowEvent.aggregateId),
    )
    .innerJoin(
      workspaceProjectMember,
      eq(workspaceProjectMember.projectId, workspaceProjectItem.projectId),
    )
    .where(
      and(
        inArray(workflowEvent.aggregateId, ids),
        eq(workspaceProjectMember.userId, actorId),
        eq(workspaceProjectItem.relation, "owned"),
        eq(workflowEvent.fromState, "FOLLOW_UP"),
        eq(workflowEvent.toState, "OPPORTUNITY"),
        eq(workflowEvent.actorType, "human"),
      ),
    );
  return [
    ...new Set(
      events
        .filter(
          (event) =>
            event.actorId.trim() &&
            Array.isArray(event.evidenceRefs) &&
            event.evidenceRefs.some((ref) => typeof ref === "string" && ref.trim()),
        )
        .map((event) => event.aggregateId),
    ),
  ];
}
