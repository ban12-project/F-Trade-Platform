import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ProductReady } from "./verification";
import {
  type ProductMediaAsset,
  productMediaAssetSchema,
  productMediaRightsSchema,
  productMediaSemanticSchema,
  productMediaTechnicalSchema,
} from "./video-readiness";

const evidenceReferenceSchema = z
  .string()
  .trim()
  .regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "必须引用私有证据记录。");

export const registerProductMediaInputSchema = z
  .object({
    productId: z.uuid(),
    evidenceRef: evidenceReferenceSchema,
    origin: z.enum(["factory", "user_upload", "licensed"]),
    semantic: productMediaSemanticSchema,
    rights: productMediaRightsSchema,
  })
  .strict();

export type RegisterProductMediaInput = z.infer<typeof registerProductMediaInputSchema>;

/** Server-derived media facts. Never populate this object from form fields. */
export const productMediaProbeSchema = z
  .object({
    mediaType: z.enum(["image", "video"]),
    technical: productMediaTechnicalSchema,
  })
  .strict()
  .superRefine((probe, context) => {
    if (!probe.technical.contentType.startsWith(`${probe.mediaType}/`)) {
      context.addIssue({
        code: "custom",
        path: ["technical", "contentType"],
        message: "媒体探测类型与 Content-Type 不一致。",
      });
    }
    if (probe.mediaType === "image") {
      if (
        probe.technical.durationMs !== null ||
        probe.technical.fps !== null ||
        probe.technical.hasAudio
      ) {
        context.addIssue({
          code: "custom",
          path: ["technical"],
          message: "图片探测结果不能包含时长、帧率或音轨。",
        });
      }
    } else if (probe.technical.durationMs === null || probe.technical.fps === null) {
      context.addIssue({
        code: "custom",
        path: ["technical"],
        message: "视频探测结果必须包含时长和帧率。",
      });
    }
  });

export type ProductMediaProbe = z.infer<typeof productMediaProbeSchema>;

export const reviewProductMediaInputSchema = z
  .object({
    assetId: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
    evidenceRef: evidenceReferenceSchema,
    notes: z.string().trim().max(1_000),
  })
  .strict();

export type ReviewProductMediaInput = z.infer<typeof reviewProductMediaInputSchema>;

export type ProductMediaEvidenceDescriptor = {
  id: string;
  contentType: string;
};

function evidenceById(evidence: readonly ProductMediaEvidenceDescriptor[]) {
  return new Map(evidence.map((item) => [item.id, item]));
}

/**
 * Creates a pending metadata record from a ProductReady product, private
 * evidence, and a trusted server-side media probe. User-facing inputs cannot
 * declare technical media facts or turn media metadata into product facts.
 */
export function createPendingProductMediaAsset(
  input: unknown,
  probeInput: unknown,
  product: ProductReady,
  evidence: readonly ProductMediaEvidenceDescriptor[],
  options: { id?: string; createdAt?: Date } = {},
): ProductMediaAsset {
  const value = registerProductMediaInputSchema.parse(input);
  const probe = productMediaProbeSchema.parse(probeInput);
  if (product.verification_status !== "verified" || product.record_id !== value.productId) {
    throw new Error("只能把媒体绑定到匹配的 ProductReady 产品。");
  }

  const availableEvidence = evidenceById(evidence);
  const sourceEvidence = availableEvidence.get(value.evidenceRef);
  if (!sourceEvidence) throw new Error("产品媒体的私有源文件证据不存在。");
  if (sourceEvidence.contentType !== probe.technical.contentType) {
    throw new Error("产品媒体探测类型与私有证据记录不一致。");
  }
  if (!availableEvidence.has(value.rights.rightsEvidenceRef)) {
    throw new Error("产品媒体的权利证据不存在。");
  }

  return productMediaAssetSchema.parse({
    id: options.id ?? randomUUID(),
    productId: value.productId,
    evidenceRef: value.evidenceRef,
    mediaType: probe.mediaType,
    origin: value.origin,
    technical: probe.technical,
    semantic: value.semantic,
    rights: value.rights,
    review: {
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      evidenceRef: null,
      notes: "",
    },
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  });
}

/**
 * Applies an independent human media decision. Pending media may be approved
 * or rejected. Approved media may later be revoked with fresh evidence and a
 * reason; rejected media is terminal and must be replaced by a new record.
 */
export function applyProductMediaReview(
  assetInput: unknown,
  reviewInput: unknown,
  reviewerId: string,
  evidence: readonly ProductMediaEvidenceDescriptor[],
  reviewedAt = new Date(),
): ProductMediaAsset {
  const asset = productMediaAssetSchema.parse(assetInput);
  const review = reviewProductMediaInputSchema.parse(reviewInput);
  if (asset.id !== review.assetId) throw new Error("素材审核决定与目标素材不匹配。");
  if (!reviewerId.trim()) throw new Error("素材审核必须由明确的人工账号执行。");
  if (Number.isNaN(reviewedAt.getTime())) throw new Error("素材审核时间无效。");
  if (!evidenceById(evidence).has(review.evidenceRef)) throw new Error("素材审核证据不存在。");

  const currentStatus = asset.review.status;
  const initialDecision = currentStatus === "pending";
  const revocation = currentStatus === "approved" && review.decision === "rejected";
  if (!initialDecision && !revocation) {
    throw new Error("当前素材审核状态不允许该决定。");
  }
  if (revocation && !review.notes.trim()) {
    throw new Error("撤销已批准素材时必须填写原因。");
  }

  return productMediaAssetSchema.parse({
    ...asset,
    review: {
      status: review.decision,
      reviewedBy: reviewerId,
      reviewedAt: reviewedAt.toISOString(),
      evidenceRef: review.evidenceRef,
      notes: review.notes,
    },
  });
}
