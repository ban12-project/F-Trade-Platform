import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { hasPermission } from "@/lib/authz";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { session, user, workspaceProject } from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { ProductAgentAccessError } from "./intake-errors";

const identitySchema = z
  .object({
    actorId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    projectId: z.uuid(),
  })
  .strict();
export type ProductAgentWriteIdentity = z.infer<typeof identitySchema>;

/** Holds the current user, session and project authorization until the write commits. */
export async function authorizeLockedProductAgentWrite(
  tx: DatabaseTransaction,
  identityInput: ProductAgentWriteIdentity,
) {
  const parsed = identitySchema.safeParse(identityInput);
  if (!parsed.success) throw new ProductAgentAccessError();
  const identity = parsed.data;
  const [actor] = await tx
    .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
    .from(user)
    .innerJoin(session, eq(session.userId, user.id))
    .where(and(eq(user.id, identity.actorId), eq(session.id, identity.sessionId)))
    .for("share");
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
