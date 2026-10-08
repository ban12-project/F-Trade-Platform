import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { workspaceProject, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";
import {
  authorizeSocialActor,
  SocialHumanAccessError,
  type SocialProjectIdentity,
} from "./human-write-access";

/** Reserve the current sales writer and owned lead after all reply/source waits. */
export async function authorizeSalesReply(
  tx: DatabaseTransaction,
  identity: SocialProjectIdentity,
  leadId: string,
) {
  const [project] = await tx
    .select({ kind: workspaceProject.kind, status: workspaceProject.status })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, identity.projectId))
    .for("share");
  const [member] = await tx
    .select({ id: workspaceProjectMember.id })
    .from(workspaceProjectMember)
    .where(
      and(
        eq(workspaceProjectMember.projectId, identity.projectId),
        eq(workspaceProjectMember.userId, identity.actorId),
        inArray(workspaceProjectMember.role, ["owner", "editor"]),
      ),
    )
    .for("share");
  const [owned] = await tx
    .select({ id: workspaceProjectItem.id })
    .from(workspaceProjectItem)
    .where(
      and(
        eq(workspaceProjectItem.projectId, identity.projectId),
        eq(workspaceProjectItem.aggregateId, leadId),
        eq(workspaceProjectItem.role, "sales_lead"),
        eq(workspaceProjectItem.relation, "owned"),
      ),
    )
    .for("share");
  if (project?.kind !== "sales" || project.status !== "active" || !member || !owned)
    throw new SocialHumanAccessError();
  return authorizeSocialActor(tx, identity, ["sales:write"]);
}
