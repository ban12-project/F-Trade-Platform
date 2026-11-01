import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { hasPermission } from "@/lib/authz";
import type { DatabaseTransaction } from "@/lib/db/client";
import { session, user, workspaceProject, workspaceProjectMember } from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import {
  authorizeLockedProductAgentWrite,
  type ProductAgentWriteIdentity,
} from "./agent-write-access";
import { ProductDocumentAccessError } from "./intake-errors";

export type DocumentUploadIdentity = ProductAgentWriteIdentity;

/** Same lock order as product writes; hold membership against direct changes too. */
export async function authorizeDocumentUpload(
  tx: DatabaseTransaction,
  input: DocumentUploadIdentity,
  projectId: string,
  purpose: string = "agent",
) {
  try {
    const identity =
      purpose === "evidence" ? input : await authorizeLockedProductAgentWrite(tx, input);
    if (purpose === "evidence") {
      const [actor] = await tx
        .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
        .from(user)
        .innerJoin(session, eq(session.userId, user.id))
        .where(and(eq(user.id, input.actorId), eq(session.id, input.sessionId)))
        .for("share");
      if (
        !actor ||
        actor.banned ||
        !hasPermission(actor.role, "product:write") ||
        actor.expiresAt <= new Date()
      )
        throw new ProductDocumentAccessError();
      await assertWorkspaceProjectAccess(projectId, input.actorId, "write", tx);
      const [project] = await tx
        .select({ kind: workspaceProject.kind })
        .from(workspaceProject)
        .where(eq(workspaceProject.id, projectId));
      if (!project || !["marketing", "sales"].includes(project.kind))
        throw new ProductDocumentAccessError();
    }
    if (identity.projectId !== projectId) throw new ProductDocumentAccessError();
    const [membership] = await tx
      .select({ id: workspaceProjectMember.id })
      .from(workspaceProjectMember)
      .where(
        and(
          eq(workspaceProjectMember.projectId, projectId),
          eq(workspaceProjectMember.userId, identity.actorId),
          inArray(workspaceProjectMember.role, ["owner", "editor"]),
        ),
      )
      .for("share");
    const [current] = await tx
      .select({ expiresAt: session.expiresAt })
      .from(session)
      .where(and(eq(session.id, identity.sessionId), eq(session.userId, identity.actorId)))
      .for("share");
    if (!membership || !current) throw new ProductDocumentAccessError();
    assertDocumentUploadDeadline(current.expiresAt);
    return { identity, expiresAt: current.expiresAt };
  } catch {
    throw new ProductDocumentAccessError();
  }
}

/** Call after the last statement as time can advance while any write waits. */
export function assertDocumentUploadDeadline(sessionExpiresAt: Date, receiptExpiresAt?: Date) {
  if (sessionExpiresAt.getTime() <= Date.now()) throw new ProductDocumentAccessError();
  if (receiptExpiresAt && receiptExpiresAt.getTime() <= Date.now())
    throw new Error("上传回执无效或已过期。");
}
