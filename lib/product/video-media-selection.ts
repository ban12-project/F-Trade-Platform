import { z } from "zod";

import type { ProductReady } from "./verification";
import {
  assessProductVideoReadiness,
  type ProductMediaAsset,
  productMediaAssetSchema,
  type VideoReadyAssessment,
} from "./video-readiness";

export const productVideoMediaSelectionSchema = z
  .object({
    productId: z.uuid("产品标识无效。"),
    assetIds: z
      .array(z.uuid("产品媒体标识无效。"))
      .min(1, "至少选择一个已审核产品媒体。")
      .max(3, "MVP1 最多选择三个产品媒体。"),
    usage: z.enum(["organic", "paid_advertising"]).default("organic"),
  })
  .strict()
  .superRefine((selection, context) => {
    const seen = new Set<string>();
    for (const [index, assetId] of selection.assetIds.entries()) {
      if (seen.has(assetId)) {
        context.addIssue({
          code: "custom",
          path: ["assetIds", index],
          message: "产品媒体不能重复选择。",
        });
      }
      seen.add(assetId);
    }
  });

export type ProductVideoMediaSelection = z.infer<typeof productVideoMediaSelectionSchema>;

export type SelectedProductVideoMedia = {
  assessment: VideoReadyAssessment;
  assets: ProductMediaAsset[];
  sourceAssets: Array<{
    assetRef: string;
    mediaType: "image" | "video";
    rightsEvidenceRef: string;
    productMediaId: string;
  }>;
};

/**
 * Resolves only currently eligible ProductMedia into the existing private
 * source-asset contract. It never returns Blob URLs and never treats an
 * editing grant as permission for generation or paid advertising.
 */
export function selectProductVideoMedia(
  product: ProductReady,
  mediaInput: readonly unknown[],
  selectionInput: unknown,
  evaluatedAt = new Date(),
): SelectedProductVideoMedia {
  if (Number.isNaN(evaluatedAt.getTime())) throw new Error("产品媒体选择时间无效。");
  const selection = productVideoMediaSelectionSchema.parse(selectionInput);
  if (product.verification_status !== "verified" || product.record_id !== selection.productId) {
    throw new Error("只能为匹配的 ProductReady 产品选择媒体。");
  }

  const media = mediaInput.map((input) => productMediaAssetSchema.parse(input));
  const assessment = assessProductVideoReadiness(product, media, evaluatedAt);
  if (assessment.status !== "ready") {
    const reason = assessment.blockers.map((issue) => issue.message).join("；");
    throw new Error(reason || "产品尚未达到 VideoReady，不能创建营销视频。");
  }

  const byId = new Map(media.map((asset) => [asset.id, asset]));
  const editingEligible = new Set(assessment.editingEligibleAssetIds);
  const selected = selection.assetIds.map((assetId) => {
    const asset = byId.get(assetId);
    if (!asset || asset.productId !== product.record_id) {
      throw new Error("所选产品媒体不存在或属于其他产品。");
    }
    if (!editingEligible.has(asset.id)) {
      throw new Error("所选产品媒体当前未通过审核、授权已过期，或缺少编辑/公开发布权限。");
    }
    if (selection.usage === "paid_advertising" && !asset.rights.paidAdvertisingAllowed) {
      throw new Error("所选产品媒体未取得付费广告授权。");
    }
    if (asset.mediaType === "video" && (asset.technical.durationMs ?? 0) < 1_000) {
      throw new Error("所选产品视频不足 1 秒，不能用于当前剪辑器。");
    }
    return asset;
  });

  return {
    assessment,
    assets: selected,
    sourceAssets: selected.map((asset) => ({
      assetRef: asset.evidenceRef,
      mediaType: asset.mediaType,
      rightsEvidenceRef: asset.rights.rightsEvidenceRef,
      productMediaId: asset.id,
    })),
  };
}
