import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { session, workspaceProjectMember } from "@/lib/db/schema";
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
) {
  try {
    const identity = await authorizeLockedProductAgentWrite(tx, input);
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
