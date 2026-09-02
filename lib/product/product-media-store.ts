import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, auditEvent } from "@/lib/db/schema";

import {
  assessProductVideoReadiness,
  productMediaAssetSchema,
  type ProductMediaAsset,
  type VideoReadyAssessment,
} from "./video-readiness";
import { parseProductReadyRecord, type ProductReady } from "./verification";

const evidenceReferenceSchema = z.string().trim().regex(
  /^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i,
  "必须引用私有证据记录。",
);

export const productMediaRegistrationSchema = productMediaAssetSchema.omit({
  id: true,
  review: true,
  createdAt: true,
}).strict();

export const productMediaDecisionSchema = z.object({
  assetId: z.uuid(),
  outcome: z.enum(["approved", "rejected"]),
  evidenceRef: evidenceReferenceSchema,
  notes: z.string().trim().max(1_000).default(""),
}).strict();

export type ProductMediaRegistration = z.infer<typeof productMediaRegistrationSchema>;
export type ProductMediaDecision = z.infer<typeof productMediaDecisionSchema>;

export type ProductMediaState = {
  product: ProductReady;
  assets: ProductMediaAsset[];
  videoReady: VideoReadyAssessment;
};

function uniqueEvidenceRefs(values: readonly string[]) {
  return [...new Set(values)];
}

export function productMediaAssets(productInput: unknown): ProductMediaAsset[] {
  const product = parseProductReadyRecord(productInput);
  return (product.media_assets ?? []).map((asset) => productMediaAssetSchema.parse(asset));
}

/**
 * Adds a server-created, pending ProductMedia record to ProductReady without
 * changing any approved engineering fact. Source and rights evidence become
 * part of the aggregate provenance immediately; use still requires review.
 */
export function registerProductMediaRecord(
  productInput: unknown,
  registrationInput: unknown,
  options: { assetId?: string; createdAt?: Date } = {},
): ProductReady {
  const product = parseProductReadyRecord(productInput);
  const registration = productMediaRegistrationSchema.parse(registrationInput);
  if (registration.productId !== product.record_id) {
    throw new Error("产品媒体必须绑定到当前 ProductReady 记录。");
  }

  const assets = productMediaAssets(product);
  if (assets.length >= 100) throw new Error("单个产品最多登记 100 个可复用媒体。");
  if (assets.some((asset) => asset.evidenceRef === registration.evidenceRef)) {
    throw new Error("该私有媒体证据已经登记到当前产品。");
  }

  const asset = productMediaAssetSchema.parse({
    ...registration,
    id: options.assetId ?? randomUUID(),
    review: {
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      evidenceRef: null,
      notes: "",
    },
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  });

  return parseProductReadyRecord({
    ...product,
    evidence_refs: uniqueEvidenceRefs([
      ...product.evidence_refs,
      asset.evidenceRef,
      asset.rights.rightsEvidenceRef,
    ]),
    media_assets: [...assets, asset],
  });
}

/** Applies one human media decision. A decided asset cannot be silently re-decided. */
export function decideProductMediaRecord(
  productInput: unknown,
  decisionInput: unknown,
  actorId: string,
  decidedAt = new Date(),
): ProductReady {
  const product = parseProductReadyRecord(productInput);
  const decision = productMediaDecisionSchema.parse(decisionInput);
  const reviewer = z.string().trim().min(1).max(240).parse(actorId);
  const assets = productMediaAssets(product);
  const index = assets.findIndex((asset) => asset.id === decision.assetId);
  if (index < 0) throw new Error("待审核的产品媒体不存在。");
  const current = assets[index]!;
  if (current.review.status !== "pending") throw new Error("产品媒体已经完成审核，不能重复决定。");

  const updated = productMediaAssetSchema.parse({
    ...current,
    review: {
      status: decision.outcome,
      reviewedBy: reviewer,
      reviewedAt: decidedAt.toISOString(),
      evidenceRef: decision.evidenceRef,
      notes: decision.notes,
    },
  });
  const nextAssets = [...assets];
  nextAssets[index] = updated;

  return parseProductReadyRecord({
    ...product,
    evidence_refs: uniqueEvidenceRefs([...product.evidence_refs, decision.evidenceRef]),
    media_assets: nextAssets,
  });
}

export function assessStoredProductVideoReadiness(
  productInput: unknown,
  evaluatedAt = new Date(),
): VideoReadyAssessment {
  const product = parseProductReadyRecord(productInput);
  return assessProductVideoReadiness(product, productMediaAssets(product), evaluatedAt);
}

function stateFromProduct(product: ProductReady, evaluatedAt = new Date()): ProductMediaState {
  const assets = productMediaAssets(product);
  return {
    product,
    assets,
    videoReady: assessProductVideoReadiness(product, assets, evaluatedAt),
  };
}

async function lockedProductReady(productId: string, database: Database) {
  const [record] = await database.select({
    state: aggregateRecord.state,
    payload: aggregateRecord.payload,
  }).from(aggregateRecord).where(and(
    eq(aggregateRecord.id, productId),
    eq(aggregateRecord.type, "product"),
  )).for("update");
  if (!record || record.state !== "PRODUCT_READY") {
    throw new Error("只能为仍处于 ProductReady 的产品登记媒体。");
  }
  return parseProductReadyRecord(record.payload);
}

export async function getProductMediaState(
  productIdInput: string,
  database: Database = getDatabase(),
  evaluatedAt = new Date(),
): Promise<ProductMediaState> {
  const productId = z.uuid().parse(productIdInput);
  const [record] = await database.select({
    state: aggregateRecord.state,
    payload: aggregateRecord.payload,
  }).from(aggregateRecord).where(and(
    eq(aggregateRecord.id, productId),
    eq(aggregateRecord.type, "product"),
  )).limit(1);
  if (!record || record.state !== "PRODUCT_READY") throw new Error("ProductReady 产品不存在。");
  return stateFromProduct(parseProductReadyRecord(record.payload), evaluatedAt);
}

export async function registerProductMediaAsset(
  registrationInput: unknown,
  actorIdInput: string,
  database: Database = getDatabase(),
): Promise<ProductMediaState> {
  const registration = productMediaRegistrationSchema.parse(registrationInput);
  const actorId = z.string().trim().min(1).max(240).parse(actorIdInput);
  const now = new Date();
  return database.transaction(async (tx) => {
    const current = await lockedProductReady(registration.productId, tx);
    const product = registerProductMediaRecord(current, registration, { createdAt: now });
    const asset = product.media_assets!.at(-1)!;

    await tx.update(aggregateRecord).set({
      payload: product,
      version: sql`${aggregateRecord.version} + 1`,
    }).where(eq(aggregateRecord.id, product.record_id));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_media.registered",
      actorType: "human",
      actorId,
      aggregateId: product.record_id,
      subjectType: "product_media",
      subjectId: asset.id,
      metadata: {
        media_type: asset.mediaType,
        origin: asset.origin,
        source_evidence_ref: asset.evidenceRef,
        rights_evidence_ref: asset.rights.rightsEvidenceRef,
        editing_allowed: asset.rights.editingAllowed,
        public_distribution_allowed: asset.rights.publicDistributionAllowed,
        paid_advertising_allowed: asset.rights.paidAdvertisingAllowed,
        image_to_video_allowed: asset.rights.imageToVideoAllowed,
        reference_to_video_allowed: asset.rights.referenceToVideoAllowed,
      },
      occurredAt: now,
    });
    return stateFromProduct(product, now);
  });
}

export async function decideProductMediaAsset(
  productIdInput: string,
  decisionInput: unknown,
  actorIdInput: string,
  database: Database = getDatabase(),
): Promise<ProductMediaState> {
  const productId = z.uuid().parse(productIdInput);
  const decision = productMediaDecisionSchema.parse(decisionInput);
  const actorId = z.string().trim().min(1).max(240).parse(actorIdInput);
  const now = new Date();
  return database.transaction(async (tx) => {
    const current = await lockedProductReady(productId, tx);
    const product = decideProductMediaRecord(current, decision, actorId, now);
    const asset = product.media_assets!.find((candidate) => candidate.id === decision.assetId)!;

    await tx.update(aggregateRecord).set({
      payload: product,
      version: sql`${aggregateRecord.version} + 1`,
    }).where(eq(aggregateRecord.id, product.record_id));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_media.reviewed",
      actorType: "human",
      actorId,
      aggregateId: product.record_id,
      subjectType: "product_media",
      subjectId: asset.id,
      metadata: {
        outcome: asset.review.status,
        decision_evidence_ref: asset.review.evidenceRef,
      },
      occurredAt: now,
    });
    return stateFromProduct(product, now);
  });
}
