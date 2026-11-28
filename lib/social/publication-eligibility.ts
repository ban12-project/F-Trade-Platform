import { and, desc, eq, inArray } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { productMediaAsset } from "@/lib/db/product-media-schema";
import {
  aggregateRecord,
  approval,
  socialChannelControl,
  workspaceProject,
  workspaceProjectItem,
} from "@/lib/db/schema";
import { assertVideoPublicationEligible, videoProjectSchema } from "@/lib/video/contracts";
import {
  assertCurrentProductMediaUsage,
  productMediaIdsForVideoProject,
  productMediaRuntimeRecordFromRow,
} from "@/lib/video/product-media-runtime-policy";
import { assertVideoRetentionForId } from "@/lib/video/retention-access";

export async function assertPublicationEligible(
  value: {
    projectId: string;
    contentRef: string;
    format: "text" | "image" | "video";
    channelRef: string;
    accountRef: string;
  },
  tx: DatabaseTransaction,
  now: Date | (() => Date),
  purpose: "dispatch" | "receipt" = "dispatch",
) {
  const [project] = await tx
    .select({ kind: workspaceProject.kind, status: workspaceProject.status })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, value.projectId))
    .for("update");
  if (project?.kind !== "marketing") throw new Error("发布只能从产品营销项目发起。");
  if (purpose === "dispatch" && project.status !== "active")
    throw new Error("项目已归档，请重开后再发起发布。");
  const [control] = await tx
    .select()
    .from(socialChannelControl)
    .where(
      and(
        eq(socialChannelControl.channelRef, value.channelRef),
        eq(socialChannelControl.accountRef, value.accountRef),
      ),
    )
    .for("update");
  if (!control?.enabled || control.circuitStatus !== "active")
    throw new Error("渠道未启用或已暂停，不能提交发布。");
  const [record] = await tx
    .select({
      version: aggregateRecord.version,
      type: aggregateRecord.type,
      state: aggregateRecord.state,
      payload: aggregateRecord.payload,
    })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, value.projectId),
        eq(workspaceProjectItem.aggregateId, value.contentRef),
        inArray(workspaceProjectItem.role, ["marketing_content", "marketing_video"]),
      ),
    )
    .for("update");
  if (!record || !["CONTENT_APPROVED", "VIDEO_APPROVED"].includes(record.state))
    throw new Error("只有 Gate 01 已批准内容或视频可以发布。");
  if ((record.type === "video") !== (value.format === "video"))
    throw new Error("发布格式与已批准记录类型不一致。");
  const [gate] = await tx
    .select({ id: approval.id, status: approval.status })
    .from(approval)
    .where(and(eq(approval.aggregateId, value.contentRef), eq(approval.gate, "gate_01_truth")))
    .orderBy(desc(approval.requestedAt), desc(approval.createdAt), desc(approval.id))
    .limit(1)
    .for("share");
  if (gate?.status !== "approved") throw new Error("缺少当前 Gate 01 批准记录。");
  if (record.type === "video") {
    await assertVideoRetentionForId(tx, value.contentRef);
    const video = videoProjectSchema.parse(record.payload);
    assertVideoPublicationEligible(video);
    const mediaIds = productMediaIdsForVideoProject(video);
    const [product] = await tx
      .select({ id: aggregateRecord.id, state: aggregateRecord.state })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, video.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (product?.state !== "PRODUCT_READY")
      throw new Error("视频引用的产品已不再处于 ProductReady，不能发布。");
    const mediaRows = mediaIds.length
      ? await tx
          .select()
          .from(productMediaAsset)
          .where(inArray(productMediaAsset.id, mediaIds))
          .for("update")
      : [];
    assertCurrentProductMediaUsage(
      video,
      mediaRows.map(productMediaRuntimeRecordFromRow),
      "organic",
      typeof now === "function" ? now() : now,
    );
    await assertVideoRetentionForId(tx, value.contentRef);
  }
  return { control, record, gate };
}
