import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  evidence,
  productDocumentUploadReceipt,
  videoReviewWorkingEvidence,
  workspaceProjectEvidence,
} from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { assertVideoRetentionForId } from "./retention-access";
import {
  assertVideoObjectRetained,
  videoRetentionMilliseconds,
  videoRetentionPolicyVersion,
} from "./retention-policy";
import {
  type VideoReviewEvidenceCopy,
  videoReviewWorkingEvidenceFormSchema,
} from "./review-evidence-contracts";
import { reviewEvidenceSourceProtectedCondition } from "./review-evidence-policy";
import {
  authorizeLockedVideoReview,
  parseVideoReviewIdentity,
  VideoReviewAccessError,
  type VideoReviewIdentity,
} from "./review-write-access";

export const VIDEO_REVIEW_COPY_MESSAGE =
  "这份附件无法登记为视频审核工作副本；请核对上传者、所属视频及来源用途。";
export class VideoReviewCopyError extends Error {
  constructor() {
    super(VIDEO_REVIEW_COPY_MESSAGE);
    this.name = "VideoReviewCopyError";
  }
}

export async function registerVideoReviewWorkingEvidence(
  input: unknown,
  identityInput: VideoReviewIdentity,
  database: Database = getDatabase(),
) {
  const value = videoReviewWorkingEvidenceFormSchema.parse(input),
    identity = parseVideoReviewIdentity(identityInput);
  if (value.projectId !== identity.projectId) throw new VideoReviewAccessError();
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, identity.actorId, "write", tx);
    const [video] = await tx
      .select({ createdAt: aggregateRecord.createdAt })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, value.videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (!video) throw new VideoReviewCopyError();
    await assertVideoRetentionForId(tx, value.videoId);
    const [file] = await tx
      .select()
      .from(evidence)
      .where(eq(evidence.id, value.evidenceRef))
      .for("update");
    if (
      !file ||
      file.uploadedByType !== "human" ||
      file.uploadedById !== identity.actorId ||
      file.blobKey.startsWith("retired/")
    )
      throw new VideoReviewCopyError();
    const [projectLink] = await tx
      .select({ id: workspaceProjectEvidence.id })
      .from(workspaceProjectEvidence)
      .where(
        and(
          eq(workspaceProjectEvidence.projectId, value.projectId),
          eq(workspaceProjectEvidence.evidenceId, file.id),
        ),
      );
    const [review] = await tx
      .select({ id: approval.id })
      .from(approval)
      .where(
        and(
          eq(approval.aggregateId, value.videoId),
          eq(approval.evidenceRef, file.id),
          eq(approval.gate, "gate_01_truth"),
          inArray(approval.status, ["approved", "rejected"]),
        ),
      );
    const [receipt] = await tx
      .select({ id: productDocumentUploadReceipt.id })
      .from(productDocumentUploadReceipt)
      .where(
        and(
          eq(productDocumentUploadReceipt.evidenceId, file.id),
          eq(productDocumentUploadReceipt.ownerId, identity.actorId),
          eq(productDocumentUploadReceipt.projectId, value.projectId),
          eq(productDocumentUploadReceipt.purpose, "evidence"),
        ),
      );
    const [protectedRow] = await tx
      .select({ protected: reviewEvidenceSourceProtectedCondition(evidence.id) })
      .from(evidence)
      .where(eq(evidence.id, file.id));
    const otherReviews = await tx
      .select({ id: approval.id })
      .from(approval)
      .where(
        and(eq(approval.evidenceRef, file.id), sql`${approval.aggregateId} <> ${value.videoId}`),
      )
      .limit(1);
    if (
      !projectLink ||
      !review ||
      !receipt ||
      !protectedRow ||
      protectedRow.protected ||
      otherReviews.length
    )
      throw new VideoReviewCopyError();
    assertVideoObjectRetained(file.createdAt);
    const expiresAt = await authorizeLockedVideoReview(tx, identity, value.videoId);
    const [existing] = await tx
      .select()
      .from(videoReviewWorkingEvidence)
      .where(eq(videoReviewWorkingEvidence.evidenceId, file.id));
    if (existing && existing.videoId !== value.videoId) throw new VideoReviewCopyError();
    if (!existing) {
      await tx.insert(videoReviewWorkingEvidence).values({
        id: randomUUID(),
        videoId: value.videoId,
        evidenceId: file.id,
        declaredById: identity.actorId,
        policyVersion: videoRetentionPolicyVersion,
      });
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "video_review_working_evidence.registered",
        actorType: "human",
        actorId: identity.actorId,
        aggregateId: value.videoId,
        subjectType: "video_review_working_evidence",
        subjectId: file.id,
        metadata: {
          evidence_ref: file.id,
          content_hash: file.sha256,
          policy_version: videoRetentionPolicyVersion,
          original_created_at: file.createdAt.toISOString(),
          working_copy_only: true,
        },
        occurredAt: new Date(),
      });
    }
    if (expiresAt <= new Date()) throw new VideoReviewAccessError();
    assertVideoObjectRetained(file.createdAt);
    assertVideoObjectRetained(video.createdAt);
    return {
      expiresAt: new Date(
        Math.min(file.createdAt.getTime(), video.createdAt.getTime()) + videoRetentionMilliseconds,
      ).toISOString(),
    };
  });
}

export async function listVideoReviewEvidenceCopies(
  videoIds: string[],
  actorId: string,
  database: Database = getDatabase(),
) {
  const result = new Map<string, VideoReviewEvidenceCopy[]>();
  if (!videoIds.length) return result;
  const rows = await database
    .selectDistinct({
      videoId: approval.aggregateId,
      evidenceRef: evidence.id,
      label: sql<string>`coalesce(${productDocumentUploadReceipt.originalFilename},${evidence.sourceLabel})`,
      createdAt: evidence.createdAt,
      videoCreatedAt: aggregateRecord.createdAt,
      ownerId: evidence.uploadedById,
      ownerType: evidence.uploadedByType,
      retired: sql<boolean>`${evidence.blobKey} LIKE 'retired/%'`,
      registeredId: videoReviewWorkingEvidence.id,
      protected: reviewEvidenceSourceProtectedCondition(evidence.id),
      receiptId: productDocumentUploadReceipt.id,
      otherReview: sql<boolean>`EXISTS(SELECT 1 FROM approval other_review WHERE other_review.evidence_ref = ${evidence.id} AND other_review.aggregate_id <> ${approval.aggregateId})`,
    })
    .from(approval)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, approval.aggregateId))
    .innerJoin(evidence, eq(evidence.id, approval.evidenceRef))
    .leftJoin(
      productDocumentUploadReceipt,
      and(
        eq(productDocumentUploadReceipt.evidenceId, evidence.id),
        eq(productDocumentUploadReceipt.purpose, "evidence"),
        eq(productDocumentUploadReceipt.ownerId, actorId),
      ),
    )
    .leftJoin(videoReviewWorkingEvidence, eq(videoReviewWorkingEvidence.evidenceId, evidence.id))
    .where(
      and(
        inArray(approval.aggregateId, videoIds),
        eq(approval.gate, "gate_01_truth"),
        inArray(approval.status, ["approved", "rejected"]),
      ),
    );
  for (const row of rows) {
    const items = result.get(row.videoId) ?? [];
    if (items.some((i) => i.evidenceRef === row.evidenceRef)) continue;
    const deadline =
      Math.min(row.createdAt.getTime(), row.videoCreatedAt.getTime()) + videoRetentionMilliseconds;
    items.push({
      evidenceRef: row.evidenceRef,
      label: row.label,
      registered: !!row.registeredId,
      canRegister:
        !!row.receiptId &&
        row.ownerType === "human" &&
        row.ownerId === actorId &&
        !row.protected &&
        !row.otherReview &&
        !row.retired &&
        deadline > Date.now(),
      expiresAt: new Date(deadline).toISOString(),
    });
    result.set(row.videoId, items);
  }
  return result;
}
