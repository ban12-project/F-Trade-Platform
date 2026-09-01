import "server-only";

import { createHash } from "node:crypto";

import { get } from "@vercel/blob";
import { and, eq, inArray } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { evidence, videoUploadReceipt, workspaceProject } from "@/lib/db/schema";

import {
  claimVideoUploadReceiptsSchema,
  completedVideoUploadTokenSchema,
  mediaTypeForVideoUpload,
  type VideoPresignedUploadPayload,
  videoUploadBlobPath,
  videoUploadContentTypeSchema,
} from "./upload-contracts";
import type { UploadedVideoSourceAsset } from "./uploaded-assets";

const imageUploadLifetimeMs = 15 * 60 * 1_000;
const videoUploadLifetimeMs = 60 * 60 * 1_000;

export async function issueVideoUploadReceipt(input: VideoPresignedUploadPayload, actorId: string, database: Database = getDatabase()) {
  const blobPath = videoUploadBlobPath(input);
  let expiresAt = new Date(Date.now() + (input.contentType.startsWith("video/") ? videoUploadLifetimeMs : imageUploadLifetimeMs));
  await database.transaction(async (tx) => {
    const [project] = await tx.select({ kind: workspaceProject.kind, status: workspaceProject.status })
      .from(workspaceProject).where(eq(workspaceProject.id, input.projectId)).for("update");
    if (!project || project.kind !== "marketing" || project.status !== "active") throw new Error("只能向进行中的产品营销项目上传视频素材。");
    const [existing] = await tx.select().from(videoUploadReceipt).where(eq(videoUploadReceipt.id, input.receiptId)).for("update");
    if (existing) {
      const sameReceipt = existing.ownerId === actorId && existing.projectId === input.projectId && existing.blobPath === blobPath
        && existing.contentType === input.contentType && existing.sizeBytes === input.sizeBytes && existing.rightsEvidenceRef === input.rightsEvidenceRef;
      if (!sameReceipt || existing.status === "failed") throw new Error("上传回执已被占用或不可重用。");
      expiresAt = existing.expiresAt;
      return;
    }
    await tx.insert(videoUploadReceipt).values({
      id: input.receiptId,
      projectId: input.projectId,
      ownerId: actorId,
      blobPath,
      originalFilename: input.originalFilename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      rightsEvidenceRef: input.rightsEvidenceRef,
      status: "issued",
      expiresAt,
    });
  });
  return { blobPath, expiresAt };
}

export async function completeVideoUploadReceipt(tokenPayloadInput: unknown, blob: { pathname: string; contentType: string; size: number }, database: Database = getDatabase()) {
  const tokenPayload = completedVideoUploadTokenSchema.parse(tokenPayloadInput);
  if (blob.pathname !== tokenPayload.blobPath || blob.contentType !== tokenPayload.contentType || blob.size !== tokenPayload.sizeBytes) {
    await database.update(videoUploadReceipt).set({ status: "failed", failureCode: "completion_mismatch" }).where(eq(videoUploadReceipt.id, tokenPayload.receiptId));
    throw new Error("上传完成信息与签名约束不一致。");
  }
  const [current] = await database.select().from(videoUploadReceipt).where(eq(videoUploadReceipt.id, tokenPayload.receiptId)).limit(1);
  if (current && ["uploaded", "claimed"].includes(current.status) && current.ownerId === tokenPayload.actorId && current.blobPath === tokenPayload.blobPath) return;
  const [updated] = await database.update(videoUploadReceipt).set({ status: "uploaded", uploadedAt: new Date(), failureCode: null })
    .where(and(eq(videoUploadReceipt.id, tokenPayload.receiptId), eq(videoUploadReceipt.ownerId, tokenPayload.actorId), eq(videoUploadReceipt.blobPath, tokenPayload.blobPath), eq(videoUploadReceipt.status, "issued")))
    .returning({ id: videoUploadReceipt.id });
  if (!updated) throw new Error("上传回执不存在、已过期或已经完成。");
}

function matchesFileSignature(contentType: string, prefix: Uint8Array) {
  const ascii = new TextDecoder().decode(prefix);
  if (contentType === "image/jpeg") return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  if (contentType === "image/png") return prefix.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (contentType === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (contentType === "video/mp4" || contentType === "video/quicktime") return ascii.slice(4, 8) === "ftyp";
  return false;
}

async function hashPrivateBlob(pathname: string, contentType: string) {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error("无法读取刚上传的私有素材。");
  const hash = createHash("sha256");
  const reader = result.stream.getReader();
  const prefix: number[] = [];
  let sizeBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const value = chunk.value;
    sizeBytes += value.byteLength;
    hash.update(value);
    for (const byte of value) if (prefix.length < 32) prefix.push(byte);
  }
  if (!matchesFileSignature(contentType, Uint8Array.from(prefix))) throw new Error("素材文件内容与声明类型不一致。");
  return { sha256: hash.digest("hex"), sizeBytes };
}

export async function claimCompletedVideoUploads(receiptIdsInput: unknown, actorId: string, projectId: string, rightsEvidenceRef: string, database: Database = getDatabase()): Promise<UploadedVideoSourceAsset[]> {
  const receiptIds = claimVideoUploadReceiptsSchema.parse(receiptIdsInput);
  let rows = [] as Array<typeof videoUploadReceipt.$inferSelect>;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    rows = await database.select().from(videoUploadReceipt).where(and(inArray(videoUploadReceipt.id, receiptIds), eq(videoUploadReceipt.ownerId, actorId), eq(videoUploadReceipt.projectId, projectId)));
    if (rows.length === receiptIds.length && rows.every((row) => row.status === "uploaded" || row.status === "claimed")) break;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (rows.length !== receiptIds.length || rows.some((row) => row.rightsEvidenceRef !== rightsEvidenceRef)) throw new Error("部分上传回执不存在或不属于当前项目。");
  if (rows.some((row) => row.expiresAt.getTime() < Date.now())) throw new Error("上传回执已过期，请重新上传素材。");

  const result: UploadedVideoSourceAsset[] = [];
  for (const row of rows) {
    if (row.status === "claimed" && row.evidenceId) {
      result.push({ assetRef: row.evidenceId, mediaType: mediaTypeForVideoUpload(videoUploadContentTypeSchema.parse(row.contentType)), rightsEvidenceRef });
      continue;
    }
    if (row.status !== "uploaded") throw new Error("素材上传尚未完成，请稍后重试。");
    const verified = await hashPrivateBlob(row.blobPath, row.contentType);
    if (verified.sizeBytes !== row.sizeBytes) throw new Error("素材大小与上传签名不一致。");
    const evidenceId = `evidence-${verified.sha256}`;
    let resolvedEvidenceId = evidenceId;
    await database.transaction(async (tx) => {
      const [current] = await tx.select().from(videoUploadReceipt).where(eq(videoUploadReceipt.id, row.id)).for("update");
      if (!current || !["uploaded", "claimed"].includes(current.status)) throw new Error("素材上传状态已发生变化。");
      const [existing] = await tx.select({ id: evidence.id }).from(evidence).where(eq(evidence.sha256, verified.sha256)).limit(1);
      resolvedEvidenceId = existing?.id ?? evidenceId;
      if (!existing) await tx.insert(evidence).values({
        id: evidenceId,
        classification: "restricted",
        blobKey: row.blobPath,
        contentType: row.contentType,
        sha256: verified.sha256,
        sizeBytes: verified.sizeBytes,
        sourceLabel: `marketing-upload:${mediaTypeForVideoUpload(videoUploadContentTypeSchema.parse(row.contentType))}`,
        uploadedByType: "human",
        uploadedById: actorId,
      });
      await tx.update(videoUploadReceipt).set({ status: "claimed", sha256: verified.sha256, evidenceId: resolvedEvidenceId, claimedAt: new Date() }).where(eq(videoUploadReceipt.id, row.id));
    });
    result.push({ assetRef: resolvedEvidenceId, mediaType: mediaTypeForVideoUpload(videoUploadContentTypeSchema.parse(row.contentType)), rightsEvidenceRef });
  }
  return result;
}
