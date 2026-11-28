import { eq } from "drizzle-orm";
import type { ProjectActorSessionIdentity } from "@/lib/actor-session";
import { lockActorSession, projectActorSessionSchema } from "@/lib/actor-session";
import { hasPermission } from "@/lib/authz";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { workspaceProject } from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { ProductAgentAccessError } from "./intake-errors";

export type ProductAgentWriteIdentity = ProjectActorSessionIdentity;

/** Holds the current user, session and project authorization until the write commits. */
export async function authorizeLockedProductAgentWrite(
  tx: DatabaseTransaction,
  identityInput: ProductAgentWriteIdentity,
) {
  const parsed = projectActorSessionSchema.safeParse(identityInput);
  if (!parsed.success) throw new ProductAgentAccessError();
  const identity = parsed.data;
  const actor = await lockActorSession(tx, identity);
  if (!actor || actor.banned || !hasPermission(actor.role, "product:write"))
    throw new ProductAgentAccessError();
  try {
    await assertWorkspaceProjectAccess(identity.projectId, identity.actorId, "write", tx);
  } catch {
    throw new ProductAgentAccessError();
  }
  const [project] = await tx
    .select({ kind: workspaceProject.kind })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, identity.projectId));
  // Expiry can occur while either authorization row lock is being acquired.
  if (project?.kind !== "marketing" || actor.expiresAt <= new Date())
    throw new ProductAgentAccessError();
  return identity;
}

/** Preflight is repeated by the persistence transaction after model execution. */
export async function assertProductAgentWriteAccess(
  identity: ProductAgentWriteIdentity,
  database: Database = getDatabase(),
) {
  return database.transaction((tx) => authorizeLockedProductAgentWrite(tx, identity));
}
