import { z } from "zod";

import type { ProductDraft, ProductReady } from "./verification";

const evidenceReferenceSchema = z.string().trim().regex(
  /^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i,
  "必须引用私有证据记录。",
);

const productFactPathSchema = z.string().trim().regex(
  /^(?:product|specifications|commercial)\.[a-z_]+$/,
  "产品事实路径无效。",
);

export const productMediaRoleSchema = z.enum([
  "product_hero",
  "product_detail",
  "packaging",
  "factory",
  "inspection",
  "application",
  "other",
]);

export const productMediaTechnicalSchema = z.object({
  contentType: z.string().trim().regex(/^(?:image|video)\/[a-z0-9.+-]+$/i, "媒体类型无效。"),
  width: z.number().int().positive().max(32_768),
  height: z.number().int().positive().max(32_768),
  durationMs: z.number().int().positive().max(120_000).nullable(),
  fps: z.number().positive().max(240).nullable(),
  hasAudio: z.boolean(),
}).strict();

export const productMediaSemanticSchema = z.object({
  role: productMediaRoleSchema,
  description: z.string().trim().max(500),
  tags: z.array(z.string().trim().min(1).max(64)).max(20),
  productVisible: z.boolean(),
  logoVisible: z.boolean(),
  textPresent: z.boolean(),
}).strict();

export const productMediaRightsSchema = z.object({
  rightsEvidenceRef: evidenceReferenceSchema,
  editingAllowed: z.boolean(),
  publicDistributionAllowed: z.boolean(),
  paidAdvertisingAllowed: z.boolean(),
  imageToVideoAllowed: z.boolean(),
  referenceToVideoAllowed: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((rights, context) => {
  if ((rights.imageToVideoAllowed || rights.referenceToVideoAllowed) && !rights.editingAllowed) {
    context.addIssue({
      code: "custom",
      path: ["editingAllowed"],
      message: "允许生成式使用前必须先取得编辑授权。",
    });
  }
});

export const productMediaReviewSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  reviewedBy: z.string().trim().min(1).max(240).nullable(),
  reviewedAt: z.string().datetime({ offset: true }).nullable(),
  evidenceRef: evidenceReferenceSchema.nullable(),
  notes: z.string().trim().max(1_000),
}).strict().superRefine((review, context) => {
  const hasDecision = review.reviewedBy !== null || review.reviewedAt !== null || review.evidenceRef !== null;
  if (review.status === "pending" && hasDecision) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "待审核素材不能携带审核决定。",
    });
  }
  if (review.status !== "pending" && (!review.reviewedBy || !review.reviewedAt || !review.evidenceRef)) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "已决定的素材审核必须记录人员、时间和证据。",
    });
  }
});

export const productMediaAssetSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  evidenceRef: evidenceReferenceSchema,
  mediaType: z.enum(["image", "video"]),
  origin: z.enum(["factory", "user_upload", "licensed"]),
  technical: productMediaTechnicalSchema,
  semantic: productMediaSemanticSchema,
  rights: productMediaRightsSchema,
  review: productMediaReviewSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((asset, context) => {
  if (!asset.technical.contentType.startsWith(`${asset.mediaType}/`)) {
    context.addIssue({
      code: "custom",
      path: ["technical", "contentType"],
      message: "媒体类别与 Content-Type 不一致。",
    });
  }
  if (asset.mediaType === "image") {
    if (asset.technical.durationMs !== null || asset.technical.fps !== null || asset.technical.hasAudio) {
      context.addIssue({
        code: "custom",
        path: ["technical"],
        message: "图片不能包含时长、帧率或音轨元数据。",
      });
    }
  } else if (asset.technical.durationMs === null || asset.technical.fps === null) {
    context.addIssue({
      code: "custom",
      path: ["technical"],
      message: "视频必须记录时长和帧率。",
    });
  }
  if (asset.mediaType !== "image" && asset.rights.imageToVideoAllowed) {
    context.addIssue({
      code: "custom",
      path: ["rights", "imageToVideoAllowed"],
      message: "只有图片素材可以授予 image-to-video 使用权。",
    });
  }
});

export type ProductMediaAsset = z.infer<typeof productMediaAssetSchema>;

export const videoReadyIssueCodeSchema = z.enum([
  "product_not_ready",
  "missing_verified_product_name",
  "missing_verified_market_identity",
  "missing_product_media",
  "media_product_mismatch",
  "media_pending_review",
  "media_rejected",
  "media_rights_expired",
  "media_editing_not_allowed",
  "media_publication_not_allowed",
  "no_editing_eligible_media",
  "no_generation_eligible_media",
]);

export const videoReadyIssueSchema = z.object({
  code: videoReadyIssueCodeSchema,
  message: z.string().trim().min(1).max(500),
  assetId: z.uuid().optional(),
}).strict();

export const videoReadyAssessmentSchema = z.object({
  version: z.literal(1),
  productId: z.uuid(),
  status: z.enum(["ready", "review_required", "not_ready"]),
  evaluatedAt: z.string().datetime({ offset: true }),
  verifiedFactPaths: z.array(productFactPathSchema),
  editingEligibleAssetIds: z.array(z.uuid()),
  generativeUse: z.object({
    imageToVideoAssetIds: z.array(z.uuid()),
    referenceToVideoAssetIds: z.array(z.uuid()),
  }).strict(),
  blockers: z.array(videoReadyIssueSchema),
  warnings: z.array(videoReadyIssueSchema),
}).strict();

export type VideoReadyAssessment = z.infer<typeof videoReadyAssessmentSchema>;

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function valueAt(product: ProductDraft | ProductReady, path: string) {
  const [section, field] = path.split(".");
  return product[section as "product" | "specifications" | "commercial"]?.[field];
}

function verifiedFactPaths(product: ProductDraft | ProductReady) {
  return (["product", "specifications", "commercial"] as const).flatMap((section) =>
    Object.entries(product[section] ?? {}).flatMap(([field, value]) => {
      const path = `${section}.${field}`;
      const evidenceRef = product.field_evidence[path];
      return hasValue(value) && evidenceRef && product.evidence_refs.includes(evidenceRef) ? [path] : [];
    }),
  ).sort();
}

function isExpired(asset: ProductMediaAsset, evaluatedAt: Date) {
  return asset.rights.expiresAt !== null && Date.parse(asset.rights.expiresAt) <= evaluatedAt.getTime();
}

/**
 * Assesses whether a ProductReady record has enough governed source material
 * for the current deterministic editor. Generative-use eligibility is reported
 * separately and never enables a provider or weakens ProductReady/Gate 01.
 */
export function assessProductVideoReadiness(
  product: ProductDraft | ProductReady,
  mediaInput: readonly unknown[],
  evaluatedAt = new Date(),
): VideoReadyAssessment {
  if (Number.isNaN(evaluatedAt.getTime())) throw new Error("VideoReady 评估时间无效。");
  const media: ProductMediaAsset[] = [];
  const mediaIds = new Set<string>();
  for (const input of mediaInput) {
    const asset = productMediaAssetSchema.parse(input);
    if (mediaIds.has(asset.id)) throw new Error(`产品媒体标识不能重复：${asset.id}`);
    mediaIds.add(asset.id);
    media.push(asset);
  }

  const facts = verifiedFactPaths(product);
  const factSet = new Set(facts);
  const blockers: z.infer<typeof videoReadyIssueSchema>[] = [];
  const warnings: z.infer<typeof videoReadyIssueSchema>[] = [];

  if (product.verification_status !== "verified") {
    blockers.push({ code: "product_not_ready", message: "产品尚未通过 Gate 01，不能进入 VideoReady。" });
  }
  if (!factSet.has("product.product_name")) {
    blockers.push({ code: "missing_verified_product_name", message: "产品名称缺少有效字段级证据。" });
  }
  const hasOeIdentity = factSet.has("product.oe_numbers") && hasValue(valueAt(product, "product.oe_numbers"));
  const hasApplicationIdentity = [
    "product.application",
    "product.vehicle_brand",
    "product.vehicle_model",
  ].every((path) => factSet.has(path));
  if (!hasOeIdentity && !hasApplicationIdentity) {
    blockers.push({
      code: "missing_verified_market_identity",
      message: "视频至少需要已核验的 OE 标识或完整车型应用身份。",
    });
  }

  const matching = media.filter((asset) => {
    if (asset.productId === product.record_id) return true;
    warnings.push({
      code: "media_product_mismatch",
      assetId: asset.id,
      message: "素材属于其他产品，已从本次 VideoReady 评估中排除。",
    });
    return false;
  });
  if (!matching.length) {
    blockers.push({ code: "missing_product_media", message: "没有绑定到当前产品的可复用媒体。" });
  }

  const eligible: string[] = [];
  const imageToVideo: string[] = [];
  const referenceToVideo: string[] = [];
  let hasPendingReview = false;

  for (const asset of matching) {
    if (asset.review.status === "pending") {
      hasPendingReview = true;
      warnings.push({ code: "media_pending_review", assetId: asset.id, message: "素材尚未完成人工权利与内容审核。" });
      continue;
    }
    if (asset.review.status === "rejected") {
      warnings.push({ code: "media_rejected", assetId: asset.id, message: "素材审核已拒绝，不能用于营销视频。" });
      continue;
    }
    if (isExpired(asset, evaluatedAt)) {
      warnings.push({ code: "media_rights_expired", assetId: asset.id, message: "素材授权已经过期。" });
      continue;
    }
    if (!asset.rights.editingAllowed) {
      warnings.push({ code: "media_editing_not_allowed", assetId: asset.id, message: "素材没有编辑授权。" });
      continue;
    }
    if (!asset.rights.publicDistributionAllowed) {
      warnings.push({ code: "media_publication_not_allowed", assetId: asset.id, message: "素材没有公开发布授权。" });
      continue;
    }

    eligible.push(asset.id);
    if (asset.mediaType === "image" && asset.rights.imageToVideoAllowed) imageToVideo.push(asset.id);
    if (asset.rights.referenceToVideoAllowed) referenceToVideo.push(asset.id);
  }

  const productFactsBlocked = blockers.some((issue) => [
    "product_not_ready",
    "missing_verified_product_name",
    "missing_verified_market_identity",
  ].includes(issue.code));

  if (!eligible.length && matching.length) {
    blockers.push({
      code: hasPendingReview ? "media_pending_review" : "no_editing_eligible_media",
      message: hasPendingReview
        ? "当前产品媒体仍在审核，暂不能进入剪辑。"
        : "当前产品没有同时满足审核、编辑和公开发布授权的媒体。",
    });
  }
  if (eligible.length && !imageToVideo.length && !referenceToVideo.length) {
    warnings.push({
      code: "no_generation_eligible_media",
      message: "现有素材可用于确定性剪辑，但未授予生成式视频使用权。",
    });
  }

  const status = productFactsBlocked || (!eligible.length && !hasPendingReview)
    ? "not_ready"
    : !eligible.length && hasPendingReview
      ? "review_required"
      : "ready";

  return videoReadyAssessmentSchema.parse({
    version: 1,
    productId: product.record_id,
    status,
    evaluatedAt: evaluatedAt.toISOString(),
    verifiedFactPaths: facts,
    editingEligibleAssetIds: eligible.sort(),
    generativeUse: {
      imageToVideoAssetIds: imageToVideo.sort(),
      referenceToVideoAssetIds: referenceToVideo.sort(),
    },
    blockers,
    warnings,
  });
}
