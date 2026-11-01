"use server";

import { z } from "zod";
import { authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";
import type { ProductEvidenceActionState } from "@/lib/action-states";
import { claimDocumentUpload } from "@/lib/product/document-upload-receipts";
import { productIntakeFailureMessage } from "@/lib/product/intake-errors";

export async function uploadProductEvidenceAction(
  _previous: ProductEvidenceActionState,
  formData: FormData,
): Promise<ProductEvidenceActionState> {
  try {
    const session = await authorizedActionSession("product:write");
    if (!session) return { status: "error", message: "无权上传资料。" };
    const projectId = z.uuid("项目标识无效。").parse(formData.get("projectId"));
    await claimDocumentUpload(
      { receiptId: formData.get("receiptId"), projectId, purpose: "evidence" },
      { actorId: session.user.id, sessionId: session.session.id, projectId },
    );
    try {
      refreshWorkspace();
    } catch {
      /* The evidence transaction already committed. */
    }
    return { status: "success", message: "资料已保存，可在来源资料列表中选择。" };
  } catch (error) {
    return {
      status: "error",
      message: productIntakeFailureMessage(error, "无法保存资料，请确认项目权限后重新上传。"),
    };
  }
}
