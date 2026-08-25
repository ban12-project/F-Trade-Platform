"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { productCatalogFormSchema } from "@/lib/form-schemas";
import { createProductCatalogDraft } from "@/lib/products";

export type ProductActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialProductActionState: ProductActionState = { status: "idle", message: "" };

export async function createProductCatalogDraftAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") {
    return { status: "error", message: "无权录入产品资料。" };
  }

  const parsed = productCatalogFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "产品资料格式不正确。" };
  }

  try {
    const result = await createProductCatalogDraft(parsed.data, session.user.id);
    revalidatePath("/console/products");
    return {
      status: "success",
      message: `产品草稿已创建（${result.id.slice(0, 8)}）。仍需 Gate 01 人工核验。`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法保存产品草稿。",
    };
  }
}
