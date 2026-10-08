import "server-only";

import { randomUUID } from "node:crypto";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { evidence, productDocumentUploadReceipt } from "@/lib/db/schema";
import { assertAndLinkProjectEvidence } from "@/lib/workspace/access";
import {
  assertDocumentUploadDeadline,
  authorizeDocumentUpload,
  type DocumentUploadIdentity,
} from "./document-upload-access";
import { verifyDocumentUploadBytes } from "./document-upload-bytes";
import {
  documentUploadClaimSchema,
  documentUploadPath,
  documentUploadPayloadSchema,
} from "./document-upload-contracts";
import { logProductIntakeFailure, productIntakeFailureDiagnostic } from "./intake-diagnostics";
import { ProductDocumentAccessError, ProductUploadError } from "./intake-errors";

const retryableReadCodes = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

type UploadReceipt = typeof productDocumentUploadReceipt.$inferSelect;

function assertReceiptSnapshot(current: UploadReceipt | undefined, original: UploadReceipt) {
  if (!current || current.expiresAt.getTime() <= Date.now())
    throw new Error("上传回执无效或已过期。");
  if (
    current.ownerId !== original.ownerId ||
    current.projectId !== original.projectId ||
    current.purpose !== original.purpose ||
    current.blobPath !== original.blobPath ||
    current.originalFilename !== original.originalFilename ||
    current.contentType !== original.contentType ||
    current.sizeBytes !== original.sizeBytes ||
    current.expiresAt.getTime() !== original.expiresAt.getTime()
  )
    throw new ProductUploadError("upload_changed");
  return current;
}

async function lockReceipt(tx: DatabaseTransaction, id: string) {
  const [current] = await tx
    .select()
    .from(productDocumentUploadReceipt)
    .where(eq(productDocumentUploadReceipt.id, id))
    .for("update");
  return current;
}

/** Recheck after asynchronous signing and immediately before returning the bearer. */
export async function assertDocumentUploadReceiptAccess(
  original: UploadReceipt,
  identity: DocumentUploadIdentity,
  database: Database = getDatabase(),
) {
  return database.transaction(async (tx) => {
    const authorization = await authorizeDocumentUpload(tx, identity, original.projectId);
    if (original.ownerId !== authorization.identity.actorId) throw new ProductDocumentAccessError();
    const current = assertReceiptSnapshot(await lockReceipt(tx, original.id), original);
    if (current.evidenceId || authorization.expiresAt < original.expiresAt)
      throw new ProductDocumentAccessError();
    assertDocumentUploadDeadline(authorization.expiresAt, current.expiresAt);
  });
}

export async function issueDocumentUploadReceipt(
  input: unknown,
  identity: DocumentUploadIdentity,
  database: Database = getDatabase(),
) {
  const value = documentUploadPayloadSchema.parse(input);
  return database.transaction(async (tx) => {
    const authorization = await authorizeDocumentUpload(tx, identity, value.projectId);
    const [row] = await tx
      .insert(productDocumentUploadReceipt)
      .values({
        ...value,
        id: value.receiptId,
        ownerId: authorization.identity.actorId,
        blobPath: documentUploadPath(value),
        expiresAt: new Date(Math.min(Date.now() + 15 * 60_000, authorization.expiresAt.getTime())),
      })
      .onConflictDoNothing()
      .returning();
    // Never reissue a token that could overwrite already-verified bytes.
    if (!row) throw new Error("上传回执已使用，请重新选择文件上传。");
    assertDocumentUploadDeadline(authorization.expiresAt, row.expiresAt);
    return row;
  });
}

export async function claimDocumentUpload(
  input: unknown,
  identity: DocumentUploadIdentity,
  database: Database = getDatabase(),
  readBlob: typeof get = get,
) {
  const value = documentUploadClaimSchema.parse(input);
  const row = await database.transaction(async (tx) => {
    const authorization = await authorizeDocumentUpload(tx, identity, value.projectId);
    const [receipt] = await tx
      .select()
      .from(productDocumentUploadReceipt)
      .where(
        and(
          eq(productDocumentUploadReceipt.id, value.receiptId),
          eq(productDocumentUploadReceipt.ownerId, authorization.identity.actorId),
          eq(productDocumentUploadReceipt.projectId, value.projectId),
          eq(productDocumentUploadReceipt.purpose, value.purpose),
        ),
      );
    if (!receipt) throw new Error("上传回执无效或已过期。");
    assertDocumentUploadDeadline(authorization.expiresAt, receipt.expiresAt);
    return receipt;
  });
  const verified = await (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        // Permission/expiry failures are outside the retry boundary.
        await database.transaction(async (tx) => {
          const authorization = await authorizeDocumentUpload(tx, identity, value.projectId);
          const current = assertReceiptSnapshot(await lockReceipt(tx, row.id), row);
          assertDocumentUploadDeadline(authorization.expiresAt, current.expiresAt);
        });
      }
      try {
        const blob = await readBlob(row.blobPath, { access: "private", useCache: false });
        const cancelRead = () => blob?.stream?.cancel().catch(() => {});
        if (blob?.statusCode !== 200 || !blob.stream) {
          await cancelRead();
          throw new ProductUploadError("upload_unavailable");
        }
        if (blob.blob.contentType !== row.contentType) {
          await blob.stream.cancel().catch(() => {});
          throw new ProductUploadError("upload_type_mismatch");
        }
        // Each attempt owns a fresh stream and byte buffer; partial reads are discarded.
        return await verifyDocumentUploadBytes(blob.stream, row.originalFilename, row.sizeBytes);
      } catch (error) {
        logProductIntakeFailure("private_blob_read", error);
        const diagnostic = productIntakeFailureDiagnostic("private_blob_read", error);
        if (
          attempt === 1 ||
          diagnostic.category !== "transport" ||
          !retryableReadCodes.has(diagnostic.code)
        )
          throw error;
      }
    }
    throw new Error("无法核验私有文件，请重新上传。");
  })();
  const evidenceId = await database.transaction(async (tx) => {
    const authorization = await authorizeDocumentUpload(tx, identity, value.projectId);
    const actorId = authorization.identity.actorId;
    const current = assertReceiptSnapshot(await lockReceipt(tx, row.id), row);
    assertDocumentUploadDeadline(authorization.expiresAt, current.expiresAt);
    if (current.evidenceId) {
      const [saved] = await tx
        .select()
        .from(evidence)
        .where(eq(evidence.id, current.evidenceId))
        .for("share");
      if (
        !saved ||
        saved.sha256 !== verified.sha256 ||
        saved.sizeBytes !== verified.sizeBytes ||
        saved.blobKey !== row.blobPath ||
        saved.contentType !== row.contentType ||
        saved.uploadedByType !== "human" ||
        saved.uploadedById !== actorId
      )
        throw new ProductUploadError("upload_changed");
      await assertAndLinkProjectEvidence(row.projectId, [saved.id], actorId, tx);
      assertDocumentUploadDeadline(authorization.expiresAt, current.expiresAt);
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
    assertDocumentUploadDeadline(authorization.expiresAt, current.expiresAt);
    return id;
  });
  return { evidenceId, ...verified, filename: row.originalFilename, contentType: row.contentType };
}
