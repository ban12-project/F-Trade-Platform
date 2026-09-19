"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { ProductEvidenceActionState } from "@/lib/action-states";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { claimDocumentUpload } from "@/lib/product/document-upload-receipts";
import { assertWorkspaceProjectKind } from "@/lib/workspace/store";

export async function uploadProductEvidenceAction(
  _previous: ProductEvidenceActionState,
  formData: FormData,
): Promise<ProductEvidenceActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:write"))
    return { status: "error", message: "无权上传产品证据。" };
  try {
    const projectId = z.uuid("项目标识无效。").parse(formData.get("projectId"));
    await assertWorkspaceProjectKind(projectId, "marketing", session.user.id);
    await claimDocumentUpload(
      { receiptId: formData.get("receiptId"), projectId, purpose: "evidence" },
      session.user.id,
    );
    revalidatePath("/workspace", "layout");
    return { status: "success", message: "证据已持久化并加入当前项目，可在字段选择器中使用。" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法上传产品证据。",
    };
  }
}
