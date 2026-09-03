import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDatabase, type Database } from "@/lib/db/client";
import { productMediaAsset } from "@/lib/db/product-media-schema";
import { aggregateRecord, approval, auditEvent, workflowEvent } from "@/lib/db/schema";
import { assertTransition } from "@/lib/workflow/transitions";

import { videoProjectSchema, type VideoProject } from "./contracts";
import { approveReviewVideoExport, type ReviewVideoExport } from "./export-artifact";
import { assertCurrentProductFacts } from "./product-fact-runtime-policy";
import {
  assertCurrentProductMediaUsage,
  productMediaIdsForVideoProject,
  productMediaRuntimeRecordFromRow,
} from "./product-media-runtime-policy";

const guardedVideoReviewSchema = z.object({
  videoId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  evidenceRef: z.string().trim().min(1),
  notes: z.string().trim().max(2_000).optional().default(""),
}).strict();

async function assertLockedCurrentProductMedia(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  project: VideoProject,
  evaluatedAt: Date,
) {
  const mediaIds = productMediaIdsForVideoProject(project);

  const [product] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, project.productId), eq(aggregateRecord.type, "product")))
    .for("update");
  if (!product || product.state !== "PRODUCT_READY") {
    throw new Error("视频引用的产品已不再处于 ProductReady，不能继续处理。");
  }
  assertCurrentProductFacts(project, product.payload);
  if (!mediaIds.length) return;

  const mediaRows = await tx.select().from(productMediaAsset)
    .where(inArray(productMediaAsset.id, mediaIds))
    .for("update");
  assertCurrentProductMediaUsage(
    project,
    mediaRows.map(productMediaRuntimeRecordFromRow),
    "organic",
    evaluatedAt,
  );
}

/** Starts rendering only while every ProductMedia binding is still valid. */
export async function beginGuardedMarketingVideoRender(
  videoId: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  const now = new Date();
  const eventId = randomUUID();
  return database.transaction(async (tx) => {
    const [record] = await tx.select().from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (!record || !["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(record.state)) {
      throw new Error("当前视频状态不能开始合成。");
    }
    const project = videoProjectSchema.parse(record.payload);
    if (!project.editDraft) throw new Error("视频缺少可合成的剪辑稿。");
    await assertLockedCurrentProductMedia(tx, project, now);

    const evidenceRefs = [...new Set([
      ...project.factualClaims.map((claim) => claim.evidenceRef),
      ...project.sourceAssets.map((asset) => asset.rightsEvidenceRef),
    ])];
    assertTransition({
      eventId,
      entityType: "video",
      entityId: videoId,
      fromState: record.state,
      toState: "VIDEO_RENDERING",
      actorType: "human",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs,
    });
    const renderingProject = videoProjectSchema.parse({
      ...project,
      status: "rendering",
      renderedAssetRef: undefined,
      exportArtifact: undefined,
    });
    await tx.update(aggregateRecord).set({
      state: "VIDEO_RENDERING",
      payload: renderingProject,
      version: sql`${aggregateRecord.version} + 1`,
    }).where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: videoId,
      fromState: record.state,
      toState: "VIDEO_RENDERING",
      actorType: "human",
      actorId,
      evidenceRefs,
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_render.started",
      actorType: "human",
      actorId,
      aggregateId: videoId,
      subjectType: "video",
      subjectId: videoId,
      metadata: {
        duration_ms: project.editDraft.clips.reduce((sum, clip) => sum + clip.durationMs, 0),
        product_media_revalidated: productMediaIdsForVideoProject(project).length,
      },
      occurredAt: now,
    });
    return renderingProject;
  });
}

/** Completes rendering only if media permission remained valid during render. */
export async function completeGuardedMarketingVideoRender(
  videoId: string,
  assetRef: string,
  exportArtifact: ReviewVideoExport,
  database: Database = getDatabase(),
) {
  const now = new Date();
  const eventId = randomUUID();
  const approvalId = randomUUID();
  const actorId = "ffmpeg:mvp1-editor";
  return database.transaction(async (tx) => {
    const [record] = await tx.select().from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (!record || record.state !== "VIDEO_RENDERING") {
      throw new Error("视频合成状态已发生变化，请刷新后重试。");
    }
    const project = videoProjectSchema.parse(record.payload);
    await assertLockedCurrentProductMedia(tx, project, now);
    if (exportArtifact.status !== "review_required" || exportArtifact.videoId !== videoId || exportArtifact.sourceAssetRef !== assetRef) {
      throw new Error("合成结果缺少与当前视频匹配的媒体校验记录。");
    }
    if (!project.editDraft || exportArtifact.platform !== project.editDraft.platform) {
      throw new Error("媒体校验记录与当前剪辑平台不一致。");
    }

    const evidenceRefs = [...new Set([
      ...project.factualClaims.map((claim) => claim.evidenceRef),
      ...project.sourceAssets.map((asset) => asset.rightsEvidenceRef),
      assetRef,
    ])];
    assertTransition({
      eventId,
      entityType: "video",
      entityId: videoId,
      fromState: "VIDEO_RENDERING",
      toState: "VIDEO_REVIEW_REQUIRED",
      actorType: "system",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs,
    });
    const reviewProject = videoProjectSchema.parse({
      ...project,
      status: "review_required",
      renderedAssetRef: assetRef,
      exportArtifact,
    });
    await tx.insert(approval).values({
      id: approvalId,
      aggregateId: videoId,
      gate: "gate_01_truth",
      status: "pending",
      requestedByType: "system",
      requestedById: actorId,
      requestedAt: now,
    });
    await tx.update(aggregateRecord).set({
      state: "VIDEO_REVIEW_REQUIRED",
      payload: reviewProject,
      version: sql`${aggregateRecord.version} + 1`,
    }).where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: videoId,
      fromState: "VIDEO_RENDERING",
      toState: "VIDEO_REVIEW_REQUIRED",
      actorType: "system",
      actorId,
      evidenceRefs,
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_render.completed",
      actorType: "system",
      actorId,
      aggregateId: videoId,
      subjectType: "video",
      subjectId: videoId,
      metadata: {
        asset_ref: assetRef,
        approval_id: approvalId,
        export_artifact_id: exportArtifact.id,
        measured_media: exportArtifact.measured,
        product_media_revalidated: productMediaIdsForVideoProject(project).length,
      },
      occurredAt: now,
    });
    return { project: reviewProject, approvalId };
  });
}

/** Approves a rendered video only while all ProductMedia rights remain valid. */
export async function decideGuardedVideoReview(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = guardedVideoReviewSchema.parse(input);
  const now = new Date();
  const eventId = randomUUID();
  return database.transaction(async (tx) => {
    const [aggregate] = await tx.select({
      id: aggregateRecord.id,
      state: aggregateRecord.state,
      version: aggregateRecord.version,
      payload: aggregateRecord.payload,
    }).from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, value.videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (!aggregate || aggregate.state !== "VIDEO_REVIEW_REQUIRED") {
      throw new Error("该视频计划当前不处于待确认状态。");
    }
    const [pendingApproval] = await tx.select().from(approval).where(and(
      eq(approval.aggregateId, aggregate.id),
      eq(approval.gate, "gate_01_truth"),
      eq(approval.status, "pending"),
    )).for("update");
    if (!pendingApproval) throw new Error("未找到待处理的视频事实确认请求。");

    const current = videoProjectSchema.parse(aggregate.payload);
    if (value.decision === "approved") {
      if (!current.exportArtifact) {
        throw new Error("成片缺少真实媒体校验记录，必须重新合成后才能批准。");
      }
      await assertLockedCurrentProductMedia(tx, current, now);
    }
    const nextState = value.decision === "approved" ? "VIDEO_APPROVED" : "VIDEO_REVISION_REQUIRED";
    const project = videoProjectSchema.parse({
      ...current,
      status: value.decision === "approved" ? "approved" : "revision_required",
      ...(value.decision === "approved" ? { approvalRefs: [...current.approvalRefs, pendingApproval.id] } : {}),
      ...(value.decision === "approved" && current.exportArtifact
        ? { exportArtifact: approveReviewVideoExport(current.exportArtifact, value.evidenceRef) }
        : {}),
    });
    assertTransition({
      eventId,
      entityType: "video",
      entityId: aggregate.id,
      fromState: "VIDEO_REVIEW_REQUIRED",
      toState: nextState,
      actorType: "human",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs: [value.evidenceRef],
      gate: "gate_01_truth",
      approvalRef: pendingApproval.id,
    }, {
      id: pendingApproval.id,
      aggregateId: aggregate.id,
      gate: "gate_01_truth",
      status: value.decision,
      decidedByType: "human",
      decidedById: actorId,
      evidenceRef: value.evidenceRef,
    });
    await tx.update(approval).set({
      status: value.decision,
      decidedByType: "human",
      decidedById: actorId,
      decidedAt: now,
      evidenceRef: value.evidenceRef,
      ...(value.notes ? { notes: value.notes } : {}),
    }).where(eq(approval.id, pendingApproval.id));
    const [updated] = await tx.update(aggregateRecord).set({
      state: nextState,
      payload: project,
      version: sql`${aggregateRecord.version} + 1`,
    }).where(and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version)))
      .returning({ id: aggregateRecord.id });
    if (!updated) throw new Error("视频确认与另一项操作冲突，请刷新后重试。");
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: aggregate.id,
      fromState: "VIDEO_REVIEW_REQUIRED",
      toState: nextState,
      actorType: "human",
      actorId,
      gate: "gate_01_truth",
      approvalId: pendingApproval.id,
      evidenceRefs: [value.evidenceRef],
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "video_gate_01_decided",
      actorType: "human",
      actorId,
      aggregateId: aggregate.id,
      subjectType: "video",
      subjectId: aggregate.id,
      metadata: {
        decision: value.decision,
        approval_id: pendingApproval.id,
        product_media_revalidated: value.decision === "approved" ? productMediaIdsForVideoProject(current).length : 0,
      },
      occurredAt: now,
    });
    return { state: nextState, approvalId: pendingApproval.id };
  });
}
