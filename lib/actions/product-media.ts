"use server";

import { revalidatePath } from "next/cache";

import { authorizedActionSession } from "@/lib/action-boundary";
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
import { productMediaFailureMessage } from "@/lib/product/media-write-access";
import { VideoDraftAccessError } from "@/lib/video/draft-write-access";
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
  revalidatePath("/workspace", "layout");
  revalidatePath(`/workspace/${projectId}`);
}

export async function registerProductMediaAction(
  _previousState: ProductMediaActionState,
  formData: FormData,
): Promise<ProductMediaActionState> {
  try {
    const session = await authorizedActionSession("product:write");
    if (!session) throw new VideoDraftAccessError();
    const value = parseProductMediaRegistrationFormData(formData);
    await assertWorkspaceAggregateLink(
      value.projectId,
      value.productId,
      "marketing",
      "product",
      session.user.id,
    );

    const [uploaded] = await claimCompletedVideoUploads(
      [value.receiptId],
      { actorId: session.user.id, sessionId: session.session.id, projectId: value.projectId },
      value.rightsEvidenceRef,
    );
    if (!uploaded) throw new Error("产品媒体上传尚未完成。");

    const sources = await issueSandboxVideoSources([uploaded.assetRef]);
    const probe = await probeProductMediaEvidenceInSandbox(uploaded.assetRef, sources);
    const input = registerProductMediaInputSchema.parse({
      ...value.input,
      evidenceRef: uploaded.assetRef,
    });
    const asset = await registerProductMediaAsset(input, probe, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId: value.projectId,
    });
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
      message: productMediaFailureMessage(error),
    };
  }
}

export async function reviewProductMediaAction(
  _previousState: ProductMediaActionState,
  formData: FormData,
): Promise<ProductMediaActionState> {
  try {
    const session = await authorizedActionSession("product:review");
    if (!session) throw new VideoDraftAccessError();
    const value = parseProductMediaReviewFormData(formData);
    await assertWorkspaceAggregateLink(
      value.projectId,
      value.productId,
      "marketing",
      "product",
      session.user.id,
    );
    const current = await listProductMediaAssets(value.productId);
    if (!current.some((asset) => asset.id === value.input.assetId)) {
      throw new Error("该产品媒体不属于当前项目中的产品。");
    }

    const asset = await reviewProductMediaAsset(value.input, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId: value.projectId,
    });
    revalidateProductMedia(value.projectId);
    return {
      status: "success",
      message:
        asset.review.status === "approved"
          ? "产品媒体已批准，可按其授权范围进入营销视频。"
          : "产品媒体已拒绝或撤销，不再进入 VideoReady。",
      productId: value.productId,
      assetId: asset.id,
    };
  } catch (error) {
    return {
      status: "error",
      message: productMediaFailureMessage(error),
    };
  }
}
