import { z } from "zod";

import { videoProjectSchema, type VideoProject } from "./contracts";

const evidenceRef = z.string().trim().regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i);

export const productMediaRuntimeUsageSchema = z.enum(["organic", "paid_advertising"]);
export type ProductMediaRuntimeUsage = z.infer<typeof productMediaRuntimeUsageSchema>;

export const currentProductMediaRecordSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  evidenceRef,
  mediaType: z.enum(["image", "video"]),
  rightsEvidenceRef: evidenceRef,
  editingAllowed: z.boolean(),
  publicDistributionAllowed: z.boolean(),
  paidAdvertisingAllowed: z.boolean(),
  rightsExpiresAt: z.coerce.date().nullable(),
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
}).strict();
export type CurrentProductMediaRecord = z.infer<typeof currentProductMediaRecordSchema>;

export function productMediaIdsForVideoProject(projectInput: unknown) {
  const project = videoProjectSchema.parse(projectInput);
  return project.sourceAssets.flatMap((asset) => asset.productMediaId ? [asset.productMediaId] : []);
}

/**
 * Revalidates every ProductMedia-backed source against its current database
 * state. Uploaded one-off sources have no productMediaId and remain governed by
 * their immutable evidence/rights references.
 */
export function assertCurrentProductMediaUsage(
  projectInput: unknown,
  recordsInput: readonly unknown[],
  usageInput: ProductMediaRuntimeUsage = "organic",
  evaluatedAt = new Date(),
): CurrentProductMediaRecord[] {
  const project = videoProjectSchema.parse(projectInput);
  const usage = productMediaRuntimeUsageSchema.parse(usageInput);
  if (Number.isNaN(evaluatedAt.getTime())) throw new Error("ProductMedia 运行时校验时间无效。");

  const bindings = project.sourceAssets.filter((asset): asset is typeof asset & { productMediaId: string } => Boolean(asset.productMediaId));
  if (!bindings.length) return [];

  const records = recordsInput.map((record) => currentProductMediaRecordSchema.parse(record));
  const byId = new Map<string, CurrentProductMediaRecord>();
  for (const record of records) {
    if (byId.has(record.id)) throw new Error(`ProductMedia 运行时记录重复：${record.id}`);
    byId.set(record.id, record);
  }

  const selected: CurrentProductMediaRecord[] = [];
  const boundIds = new Set<string>();
  for (const binding of bindings) {
    if (boundIds.has(binding.productMediaId)) throw new Error("视频项目重复绑定了同一个 ProductMedia。");
    boundIds.add(binding.productMediaId);

    const record = byId.get(binding.productMediaId);
    if (!record) throw new Error("视频项目引用的 ProductMedia 已不存在或不可访问。");
    if (record.productId !== project.productId) throw new Error("视频项目引用的 ProductMedia 属于其他产品。");
    if (record.evidenceRef !== binding.assetRef) throw new Error("ProductMedia 源文件证据已经变化，必须重新创建剪辑稿。");
    if (record.rightsEvidenceRef !== binding.rightsEvidenceRef) throw new Error("ProductMedia 权利证据已经变化，必须重新创建剪辑稿。");
    if (record.mediaType !== binding.mediaType) throw new Error("ProductMedia 媒体类型与视频项目不一致。");
    if (record.reviewStatus !== "approved") throw new Error("ProductMedia 已被拒绝、撤销或仍在审核，不能继续处理视频。");
    if (record.rightsExpiresAt && record.rightsExpiresAt.getTime() <= evaluatedAt.getTime()) {
      throw new Error("ProductMedia 授权已经过期，不能继续处理视频。");
    }
    if (!record.editingAllowed) throw new Error("ProductMedia 已不允许剪辑。");
    if (!record.publicDistributionAllowed) throw new Error("ProductMedia 已不允许公开发布。");
    if (usage === "paid_advertising" && !record.paidAdvertisingAllowed) {
      throw new Error("ProductMedia 未取得付费广告授权。");
    }
    selected.push(record);
  }

  return selected;
}

export function productMediaRuntimeRecordFromRow(row: {
  id: string;
  productId: string;
  evidenceId: string;
  mediaType: string;
  rightsEvidenceRef: string;
  editingAllowed: boolean;
  publicDistributionAllowed: boolean;
  paidAdvertisingAllowed: boolean;
  rightsExpiresAt: Date | null;
  reviewStatus: string;
}) {
  return currentProductMediaRecordSchema.parse({
    id: row.id,
    productId: row.productId,
    evidenceRef: row.evidenceId,
    mediaType: row.mediaType,
    rightsEvidenceRef: row.rightsEvidenceRef,
    editingAllowed: row.editingAllowed,
    publicDistributionAllowed: row.publicDistributionAllowed,
    paidAdvertisingAllowed: row.paidAdvertisingAllowed,
    rightsExpiresAt: row.rightsExpiresAt,
    reviewStatus: row.reviewStatus,
  });
}

export type ProductMediaBackedVideoProject = VideoProject & {
  sourceAssets: Array<VideoProject["sourceAssets"][number] & { productMediaId?: string }>;
};
