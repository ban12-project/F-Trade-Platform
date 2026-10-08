import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { get } from "@vercel/blob";
import { and, eq, inArray } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import { evidence, videoUploadReceipt } from "@/lib/db/schema";
import {
  authorizeLockedVideoDraft,
  parseVideoDraftIdentity,
  VideoDraftAccessError,
  type VideoDraftIdentity,
} from "./draft-write-access";

import {
  claimVideoUploadReceiptsSchema,
  completedVideoUploadTokenSchema,
  maximumVideoUploadBatchBytes,
  mediaTypeForVideoUpload,
  type VideoPresignedUploadPayload,
  videoUploadBlobPath,
  videoUploadContentTypeSchema,
} from "./upload-contracts";
import type { UploadedVideoSourceAsset } from "./uploaded-assets";

const imageUploadLifetimeMs = 15 * 60 * 1_000;
const videoUploadLifetimeMs = 60 * 60 * 1_000;

export async function issueVideoUploadReceipt(
  input: VideoPresignedUploadPayload,
  identityInput: VideoDraftIdentity,
  database: Database = getDatabase(),
) {
  const identity = parseVideoDraftIdentity(identityInput);
  if (identity.projectId !== input.projectId) throw new VideoDraftAccessError();
  const actorId = identity.actorId;
  const blobPath = videoUploadBlobPath(input);
  let expiresAt = new Date(
    Date.now() +
      (input.contentType.startsWith("video/") ? videoUploadLifetimeMs : imageUploadLifetimeMs),
  );
  await database.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(videoUploadReceipt)
      .where(eq(videoUploadReceipt.id, input.receiptId))
      .for("update");
    const sessionExpiresAt = await authorizeLockedVideoDraft(tx, identity);
    if (sessionExpiresAt <= new Date()) throw new VideoDraftAccessError();
    if (existing) {
      const sameReceipt =
        existing.ownerId === actorId &&
        existing.projectId === input.projectId &&
        existing.blobPath === blobPath &&
        existing.contentType === input.contentType &&
        existing.sizeBytes === input.sizeBytes &&
        existing.originalFilename === input.originalFilename &&
        existing.rightsEvidenceRef === input.rightsEvidenceRef;
      if (!sameReceipt || existing.status === "failed")
        throw new Error("上传回执已被占用或不可重用。");
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

export async function completeVideoUploadReceipt(
  tokenPayloadInput: unknown,
  blob: { pathname: string; contentType: string; size: number },
  database: Database = getDatabase(),
) {
  const tokenPayload = completedVideoUploadTokenSchema.parse(tokenPayloadInput);
  await database.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(videoUploadReceipt)
      .where(eq(videoUploadReceipt.id, tokenPayload.receiptId))
      .for("update");
    if (
      !current ||
      current.ownerId !== tokenPayload.actorId ||
      current.projectId !== tokenPayload.projectId ||
      current.blobPath !== tokenPayload.blobPath ||
      current.contentType !== tokenPayload.contentType ||
      current.sizeBytes !== tokenPayload.sizeBytes ||
      current.rightsEvidenceRef !== tokenPayload.rightsEvidenceRef ||
      current.originalFilename !== tokenPayload.originalFilename
    )
      throw new Error("上传回调与服务端回执不匹配。");
    // A late or malformed callback must never invalidate already claimed evidence.
    if (
      blob.pathname !== current.blobPath ||
      blob.contentType !== current.contentType ||
      blob.size !== current.sizeBytes
    )
      throw new Error("上传完成信息与签名约束不一致。");
    if (current.status === "claimed") return;
    if (current.status === "failed" || current.expiresAt.getTime() <= Date.now())
      throw new Error("上传回执已过期或失效。");
    if (current.status === "uploaded") return;
    await tx
      .update(videoUploadReceipt)
      .set({ status: "uploaded", uploadedAt: new Date(), failureCode: null })
      .where(eq(videoUploadReceipt.id, current.id));
  });
}

function matchesFileSignature(contentType: string, prefix: Uint8Array) {
  const ascii = new TextDecoder().decode(prefix);
  if (contentType === "image/jpeg")
    return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  if (contentType === "image/png")
    return (
      prefix.length >= 8 &&
      prefix
        .slice(0, 8)
        .every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
    );
  if (contentType === "image/webp")
    return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (contentType === "video/mp4" || contentType === "video/quicktime")
    return ascii.slice(4, 8) === "ftyp";
  return false;
}

async function hashPrivateBlob(
  pathname: string,
  contentType: string,
  expectedSize: number,
  readBlob: typeof get,
) {
  const result = await readBlob(pathname, { access: "private", useCache: false });
  if (result?.statusCode !== 200 || !result.stream || result.blob.contentType !== contentType) {
    await result?.stream?.cancel().catch(() => undefined);
    throw new Error("无法读取刚上传的私有素材。");
  }
  const hash = createHash("sha256");
  const reader = result.stream.getReader();
  const prefix: number[] = [];
  let sizeBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      sizeBytes += chunk.value.byteLength;
      if (sizeBytes > expectedSize) throw new Error("素材大小超过上传签名约束。");
      hash.update(chunk.value);
      prefix.push(...chunk.value.subarray(0, Math.max(0, 32 - prefix.length)));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!matchesFileSignature(contentType, Uint8Array.from(prefix)))
    throw new Error("素材文件内容与声明类型不一致。");
  return { sha256: hash.digest("hex"), sizeBytes };
}

/** Read blobs without DB locks; claim the complete batch under current authorization. */
export async function claimCompletedVideoUploads(
  receiptIdsInput: unknown,
  identityInput: VideoDraftIdentity,
  rightsEvidenceRef: string,
  database: Database = getDatabase(),
  readBlob: typeof get = get,
): Promise<UploadedVideoSourceAsset[]> {
  const receiptIds = claimVideoUploadReceiptsSchema.parse(receiptIdsInput);
  const identity = parseVideoDraftIdentity(identityInput);
  const { actorId, projectId } = identity;
  const rows = await database.transaction(async (tx) => {
    await authorizeLockedVideoDraft(tx, identity);
    return tx
      .select()
      .from(videoUploadReceipt)
      .where(
        and(
          inArray(videoUploadReceipt.id, receiptIds),
          eq(videoUploadReceipt.ownerId, actorId),
          eq(videoUploadReceipt.projectId, projectId),
        ),
      );
  });
  if (
    rows.length !== receiptIds.length ||
    rows.some((row) => row.rightsEvidenceRef !== rightsEvidenceRef)
  )
    throw new Error("部分上传回执不存在或不属于当前项目。");
  if (rows.reduce((total, row) => total + row.sizeBytes, 0) > maximumVideoUploadBatchBytes)
    throw new Error("一次素材总计必须小于 3GB。");
  const verified = new Map<string, { sha256: string; sizeBytes: number }>();
  for (const row of rows) {
    if (row.expiresAt.getTime() <= Date.now()) throw new Error("上传回执已过期，请重新上传素材。");
    if (row.status === "claimed" && row.evidenceId) continue;
    if (!["issued", "uploaded"].includes(row.status)) throw new Error("上传回执不可认领。");
    const hash = await hashPrivateBlob(row.blobPath, row.contentType, row.sizeBytes, readBlob);
    if (hash.sizeBytes !== row.sizeBytes) throw new Error("素材大小与上传签名不一致。");
    verified.set(row.id, hash);
  }
  return database.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(videoUploadReceipt)
      .where(inArray(videoUploadReceipt.id, receiptIds))
      .orderBy(videoUploadReceipt.id)
      .for("update");
    const expiresAt = await authorizeLockedVideoDraft(tx, identity);
    const now = new Date();
    if (expiresAt <= now) throw new VideoDraftAccessError();
    const byId = new Map(current.map((row) => [row.id, row]));
    const result: UploadedVideoSourceAsset[] = [];
    for (const id of receiptIds) {
      const row = byId.get(id),
        original = rows.find((row) => row.id === id);
      if (
        !row ||
        !original ||
        !["issued", "uploaded", "claimed"].includes(row.status) ||
        row.expiresAt <= now ||
        row.ownerId !== actorId ||
        row.projectId !== projectId ||
        row.rightsEvidenceRef !== rightsEvidenceRef ||
        row.blobPath !== original.blobPath ||
        row.contentType !== original.contentType ||
        row.sizeBytes !== original.sizeBytes
      )
        throw new Error("素材上传状态已发生变化。");
      const hash = verified.get(id);
      let evidenceId = row.evidenceId;
      if (row.status === "claimed" && evidenceId) {
        if (hash && row.sha256 !== hash.sha256) throw new Error("素材在并发核验时发生变化。");
      } else {
        if (!hash) throw new Error("素材上传状态已发生变化。");
        evidenceId = `evidence-${randomUUID()}`;
        await tx.insert(evidence).values({
          id: evidenceId,
          classification: "restricted",
          blobKey: row.blobPath,
          contentType: row.contentType,
          sha256: hash.sha256,
          sizeBytes: hash.sizeBytes,
          sourceLabel: `marketing-upload:${mediaTypeForVideoUpload(videoUploadContentTypeSchema.parse(row.contentType))}`,
          uploadedByType: "human",
          uploadedById: actorId,
        });
        await tx
          .update(videoUploadReceipt)
          .set({
            status: "claimed",
            sha256: hash.sha256,
            evidenceId,
            claimedAt: now,
            uploadedAt: row.uploadedAt ?? now,
          })
          .where(eq(videoUploadReceipt.id, id));
      }
      result.push({
        assetRef: evidenceId,
        mediaType: mediaTypeForVideoUpload(videoUploadContentTypeSchema.parse(row.contentType)),
        rightsEvidenceRef,
      });
    }
    return result;
  });
}
