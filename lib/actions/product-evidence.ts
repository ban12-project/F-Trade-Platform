"use server";

import { z } from "zod";
import { authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";
import type { ProductEvidenceActionState } from "@/lib/action-states";
import { claimDocumentUpload } from "@/lib/product/document-upload-receipts";
import { productIntakeFailureMessage } from "@/lib/product/intake-errors";
import { assertWorkspaceProjectKind } from "@/lib/workspace/store";

export async function uploadProductEvidenceAction(
  _previous: ProductEvidenceActionState,
  formData: FormData,
): Promise<ProductEvidenceActionState> {
  const session = await authorizedActionSession("product:write");
  if (!session) return { status: "error", message: "无权上传产品证据。" };
  try {
    const projectId = z.uuid("项目标识无效。").parse(formData.get("projectId"));
    await assertWorkspaceProjectKind(projectId, "marketing", session.user.id);
    await claimDocumentUpload(
      { receiptId: formData.get("receiptId"), projectId, purpose: "evidence" },
      session.user.id,
    );
    refreshWorkspace();
    return { status: "success", message: "证据已持久化并加入当前项目，可在字段选择器中使用。" };
  } catch (error) {
    return {
      status: "error",
      message: productIntakeFailureMessage(error, "无法上传产品证据，请检查项目权限及上传回执。"),
    };
  }
}
