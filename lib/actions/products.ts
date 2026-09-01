"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { productCatalogFormSchema, productReviewFormSchema } from "@/lib/form-schemas";
import { createProductCatalogDraft, decideProductCatalogReview, reviseProductCatalogDraft } from "@/lib/products";
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
  revalidatePath("/workspace");
  if (projectId) revalidatePath(`/workspace/${projectId}`);
}

export async function createProductCatalogDraftAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:write")) {
    return { status: "error", message: "无权录入产品资料。" };
  }

  const parsed = productCatalogFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "产品资料格式不正确。" };
  }

  try {
    const projectId = projectIdFrom(formData);
    if (projectId) await assertWorkspaceProjectKind(projectId, "marketing");
    const result = await createProductCatalogDraft(parsed.data, session.user.id, projectId);
    revalidateProductPaths(projectId, result.id);
    return {
      status: "success",
      message: `产品草稿已创建（${result.id.slice(0, 8)}）。仍需 Gate 01 人工核验。`,
      productId: result.id,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法保存产品草稿。",
    };
  }
}

export async function decideProductCatalogReviewAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:review")) {
    return { status: "error", message: "无权执行 Gate 01 审核。" };
  }
  const parsed = productReviewFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "审核资料格式不正确。" };
  }
  try {
    const projectId = projectIdFrom(formData);
    if (projectId) await assertWorkspaceAggregateLink(projectId, parsed.data.productId, "marketing", "product");
    const result = await decideProductCatalogReview(parsed.data, session.user.id);
    revalidateProductPaths(projectId, parsed.data.productId);
    return {
      status: "success",
      message: result.state === "PRODUCT_READY" ? "Gate 01 已批准，产品已进入 Ready。" : "Gate 01 已退回，产品需要修订。",
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法完成 Gate 01 审核。" };
  }
}

export async function reviseProductCatalogDraftAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:write")) {
    return { status: "error", message: "无权修订产品草稿。" };
  }
  const productId = formData.get("productId");
  const parsedProductId = productReviewFormSchema.pick({ productId: true }).safeParse({ productId });
  if (!parsedProductId.success) return { status: "error", message: parsedProductId.error.issues[0]?.message ?? "产品记录标识无效。" };
  const parsed = productCatalogFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "产品资料格式不正确。" };
  }
  try {
    const projectId = projectIdFrom(formData);
    if (projectId) await assertWorkspaceAggregateLink(projectId, parsedProductId.data.productId, "marketing", "product");
    await reviseProductCatalogDraft(parsedProductId.data.productId, parsed.data, session.user.id);
    revalidateProductPaths(projectId, parsedProductId.data.productId);
    return { status: "success", message: "修订已保存，并已重新提交 Gate 01 审核。", productId: parsedProductId.data.productId };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法保存产品修订。" };
  }
}
