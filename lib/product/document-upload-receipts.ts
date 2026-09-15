import "server-only";

import { randomUUID } from "node:crypto";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { evidence, productDocumentUploadReceipt, workspaceProject } from "@/lib/db/schema";
import { assertAndLinkProjectEvidence, assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { verifyDocumentUploadBytes } from "./document-upload-bytes";
import {
  documentUploadClaimSchema,
  documentUploadPath,
  documentUploadPayloadSchema,
} from "./document-upload-contracts";

async function lockAuthorizedProject(tx: DatabaseTransaction, projectId: string, actorId: string) {
  // Membership changes lock this same project row. Recheck after taking that lock.
  const [project] = await tx
    .select()
    .from(workspaceProject)
    .where(eq(workspaceProject.id, projectId))
    .for("update");
  if (!project || project.kind !== "marketing" || project.status !== "active")
    throw new Error("只能向进行中的产品营销项目上传资料。");
  await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
}

export async function issueDocumentUploadReceipt(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = documentUploadPayloadSchema.parse(input);
  return database.transaction(async (tx) => {
    await lockAuthorizedProject(tx, value.projectId, actorId);
    const [row] = await tx
      .insert(productDocumentUploadReceipt)
      .values({
        ...value,
        id: value.receiptId,
        ownerId: actorId,
        blobPath: documentUploadPath(value),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .onConflictDoNothing()
      .returning();
    // Never reissue a token that could overwrite already-verified bytes.
    if (!row) throw new Error("上传回执已使用，请重新选择文件上传。");
    return row;
  });
}

export async function claimDocumentUpload(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
  readBlob: typeof get = get,
) {
  const value = documentUploadClaimSchema.parse(input);
  await assertWorkspaceProjectAccess(value.projectId, actorId, "write", database);
  const [row] = await database
    .select()
    .from(productDocumentUploadReceipt)
    .where(
      and(
        eq(productDocumentUploadReceipt.id, value.receiptId),
        eq(productDocumentUploadReceipt.ownerId, actorId),
        eq(productDocumentUploadReceipt.projectId, value.projectId),
        eq(productDocumentUploadReceipt.purpose, value.purpose),
      ),
    );
  if (!row || row.expiresAt.getTime() <= Date.now()) throw new Error("上传回执无效或已过期。");
  const blob = await readBlob(row.blobPath, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200 || !blob.stream || blob.blob.contentType !== row.contentType)
    throw new Error("无法核验私有文件，请重新上传。");
  const verified = await verifyDocumentUploadBytes(
    blob.stream,
    row.originalFilename,
    row.sizeBytes,
  );
  const evidenceId = await database.transaction(async (tx) => {
    await lockAuthorizedProject(tx, row.projectId, actorId);
    const [current] = await tx
      .select()
      .from(productDocumentUploadReceipt)
      .where(eq(productDocumentUploadReceipt.id, row.id))
      .for("update");
    if (!current || current.expiresAt.getTime() <= Date.now()) throw new Error("上传回执已过期。");
    if (current.evidenceId) {
      const [saved] = await tx.select().from(evidence).where(eq(evidence.id, current.evidenceId));
      if (!saved || saved.sha256 !== verified.sha256 || saved.sizeBytes !== verified.sizeBytes)
        throw new Error("文件在核验后发生变化，请重新上传。");
      await assertAndLinkProjectEvidence(row.projectId, [saved.id], actorId, tx);
      return saved.id;
    }
    const id = `evidence-${randomUUID()}`;
    await tx.insert(evidence).values({
      id,
      classification: "restricted",
      blobKey: row.blobPath,
      contentType: row.contentType,
      sha256: verified.sha256,
      sizeBytes: verified.sizeBytes,
      sourceLabel: `uploaded:${row.originalFilename.split(".").at(-1)?.toLowerCase()}`,
      uploadedByType: "human",
      uploadedById: actorId,
    });
    await assertAndLinkProjectEvidence(row.projectId, [id], actorId, tx);
    await tx
      .update(productDocumentUploadReceipt)
      .set({ evidenceId: id })
      .where(eq(productDocumentUploadReceipt.id, row.id));
    return id;
  });
  return { evidenceId, ...verified, filename: row.originalFilename, contentType: row.contentType };
}
