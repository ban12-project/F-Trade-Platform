"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { ProductEvidenceActionState } from "@/lib/action-states";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { prepareUploadedProductAgentDocument } from "@/lib/product/uploaded-document";
import { assertAndLinkProjectEvidence } from "@/lib/workspace/access";
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
    const document = formData.get("document");
    if (!(document instanceof File) || document.size === 0)
      throw new Error("请选择要上传的 PDF、CSV、XLS 或 XLSX 文件。");
    await assertWorkspaceProjectKind(projectId, "marketing", session.user.id);
    const prepared = await prepareUploadedProductAgentDocument(document, session.user.id);
    await assertAndLinkProjectEvidence(projectId, prepared.source.evidence_refs, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "证据已持久化并加入当前项目，可在字段选择器中使用。" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法上传产品证据。",
    };
  }
}
