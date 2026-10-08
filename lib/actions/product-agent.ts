"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";

import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { productAgentRunFormSchema } from "@/lib/form-schemas";
import { assertProductAgentWriteAccess } from "@/lib/product/agent-write-access";
import { prepareClaimedProductDocument } from "@/lib/product/claimed-document";
import { attachClaimedProductImages } from "@/lib/product/claimed-source-images";
import { EvidenceLocatedProductAgent } from "@/lib/product/evidence-located-agent";
import { buildProductEvidenceSourceBinding } from "@/lib/product/evidence-source-binding";
import { productIntakeFailureMessage } from "@/lib/product/intake-errors";
import { createProductAgentDraft } from "@/lib/products";
import { assertAndLinkProjectEvidence } from "@/lib/workspace/access";

export type ProductAgentActionState = {
  status: "idle" | "success" | "error";
  message: string;
  productId?: string;
};
export async function runProductAgentAction(
  _previous: ProductAgentActionState,
  formData: FormData,
): Promise<ProductAgentActionState> {
  const session = await authorizedActionSession("product:write");
  if (!session) return { status: "error", message: "无权运行 Product Agent。" };
  try {
    const modelConfigId = z
      .string()
      .trim()
      .min(1, "请选择模型配置。")
      .max(120, "模型配置标识无效。")
      .parse(formData.get("modelConfigId"));
    const selectedModel = z
      .string()
      .trim()
      .min(1, "请选择模型。")
      .max(240, "模型名称无效。")
      .parse(formData.get("model"));
    const projectId = z.uuid("项目标识无效。").parse(formData.get("projectId"));
    const identity = { actorId: session.user.id, sessionId: session.session.id, projectId };
    await assertProductAgentWriteAccess(identity);
    const receiptId = formData.get("receiptId");
    if (formData.get("document") instanceof File) throw new Error("请通过私有直传上传文件。");
    const baseSource = receiptId
      ? (await prepareClaimedProductDocument(receiptId, projectId, identity)).source
      : (() => {
          const parsed = productAgentRunFormSchema.safeParse({
            ...Object.fromEntries(formData),
            hasUpload: false,
          });
          if (!parsed.success)
            throw new Error(parsed.error.issues[0]?.message ?? "资料格式不正确。");
          return {
            record_id: randomUUID(),
            source_ref: parsed.data.sourceRef!,
            evidence_refs: [parsed.data.evidenceRef!],
            source_text: parsed.data.sourceText,
            image_availability: "none" as const,
            image_refs: [],
          };
        })();
    const source = await attachClaimedProductImages(
      baseSource,
      formData.getAll("imageReceiptId"),
      projectId,
      identity,
    );
    await assertAndLinkProjectEvidence(projectId, source.evidence_refs, session.user.id);
    const model = createProductAgentModel(
      await resolveProductAgentModelConfig(modelConfigId, selectedModel),
    );
    await assertProductAgentWriteAccess(identity);
    const result = await new EvidenceLocatedProductAgent().run({
      model,
      source,
      timeout_ms: 75_000,
    });
    const saved = await createProductAgentDraft(
      result.draft,
      identity,
      {
        prompt_version: result.metadata.prompt_version,
        prompt_hash: result.metadata.prompt_hash,
        evidence_mode: "bounded_location",
        source_evidence_binding: buildProductEvidenceSourceBinding(source),
      },
      source.image_refs,
    );
    refreshWorkspace();
    revalidatePath(`/workspace/${projectId}`);
    return {
      status: "success",
      message: `已生成待 Gate 01 审核草稿（${saved.id.slice(0, 8)}），每个事实均绑定可核查位置。`,
      productId: saved.id,
    };
  } catch (error) {
    return { status: "error", message: productIntakeFailureMessage(error) };
  }
}
