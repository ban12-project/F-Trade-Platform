import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import productReadySchema from "@/contracts/data/product-ready.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import { getDatabase, type Database } from "@/lib/db/client";
import { productMediaAsset } from "@/lib/db/product-media-schema";
import { aggregateRecord, auditEvent, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import { selectProductVideoMedia } from "@/lib/product/video-media-selection";
import { productMediaAssetSchema, type ProductMediaAsset } from "@/lib/product/video-readiness";
import type { ProductReady } from "@/lib/product/verification";

import { videoProjectSchema } from "./contracts";
import { buildVideoCreative } from "./creative";
import { createMarketingVideoFromProductMediaSchema, marketingVideoDraftSchema } from "./edit-contracts";

const parseProductReady = compileContract<ProductReady>(productReadySchema);
type ProductMediaRow = typeof productMediaAsset.$inferSelect;

function mediaFromRow(row: ProductMediaRow): ProductMediaAsset {
  return productMediaAssetSchema.parse({
    id: row.id,
    productId: row.productId,
    evidenceRef: row.evidenceId,
    mediaType: row.mediaType,
    origin: row.origin,
    technical: {
      contentType: row.contentType,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      fps: row.fps,
      hasAudio: row.hasAudio,
    },
    semantic: {
      role: row.role,
      description: row.description,
      tags: row.tags,
      productVisible: row.productVisible,
      logoVisible: row.logoVisible,
      textPresent: row.textPresent,
    },
    rights: {
      rightsEvidenceRef: row.rightsEvidenceRef,
      editingAllowed: row.editingAllowed,
      publicDistributionAllowed: row.publicDistributionAllowed,
      paidAdvertisingAllowed: row.paidAdvertisingAllowed,
      imageToVideoAllowed: row.imageToVideoAllowed,
      referenceToVideoAllowed: row.referenceToVideoAllowed,
      expiresAt: row.rightsExpiresAt?.toISOString() ?? null,
    },
    review: {
      status: row.reviewStatus,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      evidenceRef: row.reviewEvidenceRef,
      notes: row.reviewNotes,
    },
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * Creates an editable marketing-video project from reusable ProductMedia.
 * Product, project link, and selected media rows are locked in one transaction
 * so a concurrent rights revocation cannot race the creation decision.
 */
export async function createMarketingVideoEditProjectFromProductMedia(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = createMarketingVideoFromProductMediaSchema.parse(input);
  if (!actorId.trim()) throw new Error("创建营销视频需要明确的人工账号。");

  const id = randomUUID();
  const now = new Date();
  return database.transaction(async (tx) => {
    const [workspace] = await tx.select({ id: workspaceProject.id, kind: workspaceProject.kind, status: workspaceProject.status })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, value.projectId))
      .for("update");
    if (!workspace || workspace.kind !== "marketing" || workspace.status !== "active") {
      throw new Error("只能在进行中的产品营销项目中创建营销视频。");
    }

    const [productLink] = await tx.select({ id: workspaceProjectItem.id })
      .from(workspaceProjectItem)
      .where(and(
        eq(workspaceProjectItem.projectId, value.projectId),
        eq(workspaceProjectItem.aggregateId, value.productId),
      ))
      .for("update");
    if (!productLink) throw new Error("只能使用当前营销项目中已关联的产品。");

    const [productRow] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, payload: aggregateRecord.payload })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, value.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!productRow || productRow.state !== "PRODUCT_READY") {
      throw new Error("只能从已通过 Gate 01 的产品创建营销视频。");
    }
    const ready = parseProductReady(productRow.payload);
    if (ready.record_id !== productRow.id) throw new Error("产品聚合标识与 ProductReady 契约不一致。");

    const mediaRows = await tx.select().from(productMediaAsset)
      .where(inArray(productMediaAsset.id, value.productMediaIds))
      .for("update");
    const selected = selectProductVideoMedia(ready, mediaRows.map(mediaFromRow), {
      productId: ready.record_id,
      assetIds: value.productMediaIds,
      usage: "organic",
    }, now);

    const selectedFacts = ["product.product_name", value.factPath]
      .filter((path, index, paths) => paths.indexOf(path) === index && Boolean(ready.field_evidence[path]));
    const clips = selected.assets.map((asset, index) => ({
      clipId: `clip-${String(index + 1).padStart(3, "0")}`,
      assetRef: asset.evidenceRef,
      mediaType: asset.mediaType,
      trimStartMs: 0,
      durationMs: asset.mediaType === "image" ? 3_000 : Math.min(5_000, asset.technical.durationMs!),
      fitMode: "contain" as const,
      audioMode: "muted" as const,
      caption: { kind: "none" as const },
    }));
    const editDraft = marketingVideoDraftSchema.parse({
      version: 2,
      platform: value.platform,
      clips,
      ctaText: "Contact us for details",
    });
    const creative = buildVideoCreative({
      productId: productRow.id,
      objective: value.objective,
      targetAudience: value.targetAudience,
      factPaths: selectedFacts,
      sourceAssets: selected.sourceAssets,
      platforms: [value.platform],
      scenes: clips.map((clip) => ({
        prompt: "已审核的可复用产品媒体",
        durationSeconds: clip.durationMs / 1_000,
        claimRefs: [],
        assetRefs: [clip.assetRef],
      })),
    }, ready, id);
    const project = videoProjectSchema.parse({ ...creative, status: "draft", editDraft });

    await tx.insert(aggregateRecord).values({
      id,
      type: "video",
      state: "VIDEO_DRAFT",
      payload: project,
      createdByType: "human",
      createdById: actorId,
    });
    await tx.insert(workspaceProjectItem).values({
      id: randomUUID(),
      projectId: value.projectId,
      aggregateId: id,
      role: "marketing_video",
      relation: "owned",
    });
    await tx.update(workspaceProject).set({ updatedAt: now }).where(eq(workspaceProject.id, value.projectId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_edit.created",
      actorType: "human",
      actorId,
      aggregateId: id,
      subjectType: "video",
      subjectId: id,
      metadata: {
        project_id: value.projectId,
        platform: value.platform,
        clip_count: clips.length,
        source_mode: "product_media",
        product_media_ids: value.productMediaIds,
      },
      occurredAt: now,
    });
    return { id, project };
  });
}
