"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import {
  parseProductMediaRegistrationFormData,
  parseProductMediaReviewFormData,
} from "@/lib/product/media-form-schemas";
import { probeProductMediaEvidenceInSandbox } from "@/lib/product/media-sandbox-probe";
import { registerProductMediaInputSchema } from "@/lib/product/media-service";
import {
  listProductMediaAssets,
  registerProductMediaAsset,
  reviewProductMediaAsset,
} from "@/lib/product/media-store";
import { issueSandboxVideoSources } from "@/lib/video/sandbox-sources";
import { claimCompletedVideoUploads } from "@/lib/video/upload-receipts";
import { assertWorkspaceAggregateLink } from "@/lib/workspace/store";

export type ProductMediaActionState = {
  status: "idle" | "success" | "error";
  message: string;
  productId?: string;
  assetId?: string;
};

function revalidateProductMedia(projectId: string) {
  revalidatePath("/workspace");
  revalidatePath(`/workspace/${projectId}`);
}

export async function registerProductMediaAction(
  _previousState: ProductMediaActionState,
  formData: FormData,
): Promise<ProductMediaActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:write")) {
    return { status: "error", message: "无权登记产品媒体。" };
  }

  try {
    const value = parseProductMediaRegistrationFormData(formData);
    await assertWorkspaceAggregateLink(value.projectId, value.productId, "marketing", "product", session.user.id);

    const [uploaded] = await claimCompletedVideoUploads(
      [value.receiptId],
      session.user.id,
      value.projectId,
      value.rightsEvidenceRef,
    );
    if (!uploaded) throw new Error("产品媒体上传尚未完成。");

    const sources = await issueSandboxVideoSources([uploaded.assetRef]);
    const probe = await probeProductMediaEvidenceInSandbox(uploaded.assetRef, sources);
    const input = registerProductMediaInputSchema.parse({
      ...value.input,
      evidenceRef: uploaded.assetRef,
    });
    const asset = await registerProductMediaAsset(input, probe, session.user.id);
    revalidateProductMedia(value.projectId);
    return {
      status: "success",
      message: "产品媒体已登记并完成技术探测，等待管理员审核权利与内容。",
      productId: value.productId,
      assetId: asset.id,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法登记产品媒体。",
    };
  }
}

export async function reviewProductMediaAction(
  _previousState: ProductMediaActionState,
  formData: FormData,
): Promise<ProductMediaActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:review")) {
    return { status: "error", message: "只有管理员可以审核产品媒体。" };
  }

  try {
    const value = parseProductMediaReviewFormData(formData);
    await assertWorkspaceAggregateLink(value.projectId, value.productId, "marketing", "product", session.user.id);
    const current = await listProductMediaAssets(value.productId);
    if (!current.some((asset) => asset.id === value.input.assetId)) {
      throw new Error("该产品媒体不属于当前项目中的产品。");
    }

    const asset = await reviewProductMediaAsset(value.input, session.user.id);
    revalidateProductMedia(value.projectId);
    return {
      status: "success",
      message: asset.review.status === "approved"
        ? "产品媒体已批准，可按其授权范围进入营销视频。"
        : "产品媒体已拒绝或撤销，不再进入 VideoReady。",
      productId: value.productId,
      assetId: asset.id,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法审核产品媒体。",
    };
  }
}
