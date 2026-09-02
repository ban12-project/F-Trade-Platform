import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import productDraftSchema from "../../contracts/data/product-draft.schema.json";
import productReadySchema from "../../contracts/data/product-ready.schema.json";
import { compileContract } from "../contracts/validator";
import { getDatabase, type Database } from "../db/client";
import { productMediaAsset } from "../db/product-media-schema";
import { aggregateRecord, auditEvent, evidence as evidenceTable } from "../db/schema";
import {
  applyProductMediaReview,
  createPendingProductMediaAsset,
  productMediaProbeSchema,
  registerProductMediaInputSchema,
  reviewProductMediaInputSchema,
  type ProductMediaProbe,
  type RegisterProductMediaInput,
  type ReviewProductMediaInput,
} from "./media-service";
import type { ProductDraft, ProductReady } from "./verification";
import {
  assessProductVideoReadiness,
  productMediaAssetSchema,
  type ProductMediaAsset,
  type VideoReadyAssessment,
} from "./video-readiness";

const parseProductDraft = compileContract<ProductDraft>(productDraftSchema);
const parseProductReady = compileContract<ProductReady>(productReadySchema);

type ProductMediaRow = typeof productMediaAsset.$inferSelect;

function rowToProductMediaAsset(row: ProductMediaRow): ProductMediaAsset {
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

function insertValues(asset: ProductMediaAsset, actorId: string) {
  return {
    id: asset.id,
    productId: asset.productId,
    evidenceId: asset.evidenceRef,
    origin: asset.origin,
    mediaType: asset.mediaType,
    role: asset.semantic.role,
    contentType: asset.technical.contentType,
    width: asset.technical.width,
    height: asset.technical.height,
    durationMs: asset.technical.durationMs,
    fps: asset.technical.fps,
    hasAudio: asset.technical.hasAudio,
    description: asset.semantic.description,
    tags: asset.semantic.tags,
    productVisible: asset.semantic.productVisible,
    logoVisible: asset.semantic.logoVisible,
    textPresent: asset.semantic.textPresent,
    rightsEvidenceRef: asset.rights.rightsEvidenceRef,
    editingAllowed: asset.rights.editingAllowed,
    publicDistributionAllowed: asset.rights.publicDistributionAllowed,
    paidAdvertisingAllowed: asset.rights.paidAdvertisingAllowed,
    imageToVideoAllowed: asset.rights.imageToVideoAllowed,
    referenceToVideoAllowed: asset.rights.referenceToVideoAllowed,
    rightsExpiresAt: asset.rights.expiresAt ? new Date(asset.rights.expiresAt) : null,
    reviewStatus: asset.review.status,
    reviewedBy: asset.review.reviewedBy,
    reviewedAt: asset.review.reviewedAt ? new Date(asset.review.reviewedAt) : null,
    reviewEvidenceRef: asset.review.evidenceRef,
    reviewNotes: asset.review.notes,
    createdBy: actorId,
    createdAt: new Date(asset.createdAt),
  } as const;
}

async function loadProduct(productId: string, database: Database) {
  const [row] = await database.select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, productId), eq(aggregateRecord.type, "product")))
    .limit(1);
  if (!row) throw new Error("产品不存在。");
  const product = row.state === "PRODUCT_READY"
    ? parseProductReady(row.payload)
    : parseProductDraft(row.payload);
  if (product.record_id !== productId) throw new Error("产品聚合标识与产品契约不一致。");
  return { state: row.state, product };
}

/**
 * Registers one reusable media record. User input carries only semantics and
 * rights; technical facts must come from a trusted server-side media probe.
 */
export async function registerProductMediaAsset(
  input: RegisterProductMediaInput,
  probeInput: ProductMediaProbe,
  actorId: string,
  database: Database = getDatabase(),
): Promise<ProductMediaAsset> {
  const value = registerProductMediaInputSchema.parse(input);
  const probe = productMediaProbeSchema.parse(probeInput);
  if (!actorId.trim()) throw new Error("创建产品媒体需要明确的人工账号。");

  return database.transaction(async (tx) => {
    const [productRow] = await tx.select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, value.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!productRow || productRow.state !== "PRODUCT_READY") {
      throw new Error("只能为当前 ProductReady 产品登记可复用媒体。");
    }
    const product = parseProductReady(productRow.payload);
    if (product.record_id !== value.productId) throw new Error("产品聚合标识与产品契约不一致。");

    const requiredEvidence = [...new Set([value.evidenceRef, value.rights.rightsEvidenceRef])];
    const evidenceRows = await tx.select({ id: evidenceTable.id, contentType: evidenceTable.contentType })
      .from(evidenceTable)
      .where(inArray(evidenceTable.id, requiredEvidence));
    const asset = createPendingProductMediaAsset(value, probe, product, evidenceRows);

    await tx.insert(productMediaAsset).values(insertValues(asset, actorId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_media.created",
      actorType: "human",
      actorId,
      aggregateId: value.productId,
      subjectType: "product_media",
      subjectId: asset.id,
      metadata: {
        evidence_ref: asset.evidenceRef,
        media_type: asset.mediaType,
        role: asset.semantic.role,
        editing_allowed: asset.rights.editingAllowed,
        public_distribution_allowed: asset.rights.publicDistributionAllowed,
        image_to_video_allowed: asset.rights.imageToVideoAllowed,
        reference_to_video_allowed: asset.rights.referenceToVideoAllowed,
      },
      occurredAt: new Date(asset.createdAt),
    });
    return asset;
  });
}

/**
 * Records an independent human media decision. Approval re-checks and locks
 * ProductReady. Rejection and revocation remain available even if the product
 * later leaves ProductReady, so unsafe media can always be disabled.
 */
export async function reviewProductMediaAsset(
  input: ReviewProductMediaInput,
  reviewerId: string,
  database: Database = getDatabase(),
): Promise<ProductMediaAsset> {
  const value = reviewProductMediaInputSchema.parse(input);
  if (!reviewerId.trim()) throw new Error("素材审核必须由明确的人工账号执行。");

  return database.transaction(async (tx) => {
    const [row] = await tx.select().from(productMediaAsset)
      .where(eq(productMediaAsset.id, value.assetId))
      .for("update");
    if (!row) throw new Error("产品媒体不存在。");

    if (value.decision === "approved") {
      const [productRow] = await tx.select({ state: aggregateRecord.state }).from(aggregateRecord)
        .where(and(eq(aggregateRecord.id, row.productId), eq(aggregateRecord.type, "product")))
        .for("update");
      if (!productRow || productRow.state !== "PRODUCT_READY") {
        throw new Error("产品已不再处于 ProductReady，不能批准其媒体。");
      }
    }

    const [reviewEvidence] = await tx.select({ id: evidenceTable.id, contentType: evidenceTable.contentType })
      .from(evidenceTable)
      .where(eq(evidenceTable.id, value.evidenceRef))
      .limit(1);
    const previousStatus = row.reviewStatus;
    const reviewedAt = new Date();
    const reviewed = applyProductMediaReview(
      rowToProductMediaAsset(row),
      value,
      reviewerId,
      reviewEvidence ? [reviewEvidence] : [],
      reviewedAt,
    );

    await tx.update(productMediaAsset).set({
      reviewStatus: reviewed.review.status,
      reviewedBy: reviewed.review.reviewedBy,
      reviewedAt,
      reviewEvidenceRef: reviewed.review.evidenceRef,
      reviewNotes: reviewed.review.notes,
      version: sql`${productMediaAsset.version} + 1`,
      updatedAt: reviewedAt,
    }).where(eq(productMediaAsset.id, reviewed.id));

    const action = reviewed.review.status === "approved"
      ? "product_media.approved"
      : previousStatus === "approved"
        ? "product_media.revoked"
        : "product_media.rejected";
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action,
      actorType: "human",
      actorId: reviewerId,
      aggregateId: reviewed.productId,
      subjectType: "product_media",
      subjectId: reviewed.id,
      metadata: {
        decision: reviewed.review.status,
        previous_status: previousStatus,
        evidence_ref: reviewed.review.evidenceRef,
      },
      occurredAt: reviewedAt,
    });
    return reviewed;
  });
}

export async function listProductMediaAssets(
  productId: string,
  database: Database = getDatabase(),
): Promise<ProductMediaAsset[]> {
  const rows = await database.select().from(productMediaAsset)
    .where(eq(productMediaAsset.productId, productId))
    .orderBy(desc(productMediaAsset.createdAt));
  return rows.map(rowToProductMediaAsset);
}

export async function getProductVideoReadiness(
  productId: string,
  evaluatedAt = new Date(),
  database: Database = getDatabase(),
): Promise<VideoReadyAssessment> {
  const [{ product }, media] = await Promise.all([
    loadProduct(productId, database),
    listProductMediaAssets(productId, database),
  ]);
  return assessProductVideoReadiness(product, media, evaluatedAt);
}

export async function listEditingEligibleProductMedia(
  productId: string,
  evaluatedAt = new Date(),
  database: Database = getDatabase(),
): Promise<{ assessment: VideoReadyAssessment; assets: ProductMediaAsset[] }> {
  const [{ product }, media] = await Promise.all([
    loadProduct(productId, database),
    listProductMediaAssets(productId, database),
  ]);
  const assessment = assessProductVideoReadiness(product, media, evaluatedAt);
  const eligible = new Set(assessment.editingEligibleAssetIds);
  return { assessment, assets: media.filter((asset) => eligible.has(asset.id)) };
}
