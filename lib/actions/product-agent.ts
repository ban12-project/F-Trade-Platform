"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { productAgentRunFormSchema } from "@/lib/form-schemas";
import { AiSdkProductAgent } from "@/lib/product/agent";
import { createProductAgentDraft } from "@/lib/products";
import { prepareUploadedProductAgentDocument } from "@/lib/product/uploaded-document";
import { assertWorkspaceProjectKind } from "@/lib/workspace/store";

export type ProductAgentActionState = { status: "idle" | "success" | "error"; message: string; productId?: string };
export async function runProductAgentAction(_previous: ProductAgentActionState, formData: FormData): Promise<ProductAgentActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:write")) return { status: "error", message: "无权运行 Product Agent。" };
  try {
    const rawProjectId = formData.get("projectId");
    const projectId = rawProjectId === null || rawProjectId === "" ? undefined : z.uuid("项目标识无效。").parse(rawProjectId);
    if (projectId) await assertWorkspaceProjectKind(projectId, "marketing");
    const uploaded = formData.get("document");
    const source = uploaded instanceof File && uploaded.size > 0
      ? (await prepareUploadedProductAgentDocument(uploaded, session.user.id)).source
      : (() => {
          const parsed = productAgentRunFormSchema.safeParse({ ...Object.fromEntries(formData), hasUpload: false });
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "资料格式不正确。");
          return { record_id: randomUUID(), source_ref: parsed.data.sourceRef!, evidence_refs: [parsed.data.evidenceRef!], source_text: parsed.data.sourceText, image_availability: "none" as const, image_refs: [] };
        })();
    const result = await new AiSdkProductAgent().run({ model: createProductAgentModel(await resolveProductAgentModelConfig()), source, timeout_ms: 75_000 });
    const saved = await createProductAgentDraft(result.draft, session.user.id, { prompt_version: result.metadata.prompt_version, prompt_hash: result.metadata.prompt_hash }, projectId);
    revalidatePath("/workspace");
    if (projectId) revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: `已生成待 Gate 01 审核草稿（${saved.id.slice(0, 8)}）。`, productId: saved.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Product Agent 运行失败。" };
  }
}
