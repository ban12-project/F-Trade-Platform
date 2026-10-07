"use server";

import { z } from "zod";
import { actionError, authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";

import { productReviewFormSchema } from "@/lib/form-schemas";
import { productCatalogFormSchema } from "@/lib/product/catalog-form-schema";
import {
  createEvidenceBoundProductCatalogDraft as createProductCatalogDraft,
  reviseEvidenceBoundProductCatalogDraft as reviseProductCatalogDraft,
} from "@/lib/product/evidence-bound-catalog";
import { productReviewFailureMessage } from "@/lib/product/review-write-access";
import { decideProductCatalogReview } from "@/lib/products";
import { assertWorkspaceAggregateLink, assertWorkspaceProjectKind } from "@/lib/workspace/store";

export type ProductActionState = {
  status: "idle" | "success" | "error";
  message: string;
  productId?: string;
};

function projectIdFrom(formData: FormData) {
  const value = formData.get("projectId");
  if (value === null || value === "") return undefined;
  return z.uuid("项目标识无效。").parse(value);
}

function revalidateProductPaths(projectId: string | undefined, productId?: string) {
  void productId;
  refreshWorkspace(projectId);
}

export async function createProductCatalogDraftAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await authorizedActionSession("product:write");
  if (!session) {
    return { status: "error", message: "无权录入产品资料。" };
  }

  const parsed = productCatalogFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "产品资料格式不正确。" };
  }

  try {
    const projectId = projectIdFrom(formData);
    if (projectId) await assertWorkspaceProjectKind(projectId, "marketing", session.user.id);
    const result = await createProductCatalogDraft(parsed.data, session.user.id, projectId);
    revalidateProductPaths(projectId, result.id);
    return {
      status: "success",
      message: `产品草稿已创建（${result.id.slice(0, 8)}）。每个事实均保留独立证据，仍需 Gate 01 人工核验。`,
      productId: result.id,
    };
  } catch (error) {
    return actionError(error, "无法保存产品草稿。");
  }
}

export async function decideProductCatalogReviewAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await authorizedActionSession("product:review");
  if (!session) {
    return { status: "error", message: "无权执行 Gate 01 审核。" };
  }
  const parsed = productReviewFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "审核资料格式不正确。" };
  }
  try {
    const projectId = z.uuid("项目标识无效。").parse(formData.get("projectId"));
    await assertWorkspaceAggregateLink(
      projectId,
      parsed.data.productId,
      "marketing",
      "product",
      session.user.id,
    );
    const result = await decideProductCatalogReview(parsed.data, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId,
    });
    revalidateProductPaths(projectId, parsed.data.productId);
    return {
      status: "success",
      message:
        result.state === "PRODUCT_READY"
          ? "Gate 01 已批准，产品已进入 Ready。"
          : "Gate 01 已退回，产品需要修订。",
    };
  } catch (error) {
    return { status: "error", message: productReviewFailureMessage(error) };
  }
}

export async function reviseProductCatalogDraftAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await authorizedActionSession("product:write");
  if (!session) {
    return { status: "error", message: "无权修订产品草稿。" };
  }
  const productId = formData.get("productId");
  const parsedProductId = productReviewFormSchema.shape.productId.safeParse(productId);
  if (!parsedProductId.success)
    return {
      status: "error",
      message: parsedProductId.error.issues[0]?.message ?? "产品记录标识无效。",
    };
  const parsed = productCatalogFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "产品资料格式不正确。" };
  }
  try {
    const projectId = projectIdFrom(formData);
    if (projectId)
      await assertWorkspaceAggregateLink(
        projectId,
        parsedProductId.data,
        "marketing",
        "product",
        session.user.id,
      );
    if (!projectId) throw new Error("产品修订必须在所属项目中进行。");
    await reviseProductCatalogDraft(parsedProductId.data, parsed.data, session.user.id, projectId);
    revalidateProductPaths(projectId, parsedProductId.data);
    return {
      status: "success",
      message: "修订及逐字段证据已保存，并重新提交 Gate 01 审核。",
      productId: parsedProductId.data,
    };
  } catch (error) {
    return actionError(error, "无法保存产品修订。");
  }
}
