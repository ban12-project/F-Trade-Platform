"use server";

import { z } from "zod";
import { actionError, authorizedActionSession } from "@/lib/action-boundary";

import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import {
  type contentGenerationOutputSchema,
  generateMarketingContent,
} from "@/lib/content/generation";
import { listReadyProductContentSources } from "@/lib/content/store";
import { contentAgentRequestSchema } from "@/lib/form-schemas";
import { assertWorkspaceProjectKind } from "@/lib/workspace/store";

export type ContentAgentActionState = {
  status: "idle" | "success" | "error";
  message: string;
  draft?: z.infer<typeof contentGenerationOutputSchema>;
};
export async function generateContentDraftAction(
  _previous: ContentAgentActionState,
  formData: FormData,
): Promise<ContentAgentActionState> {
  const session = await authorizedActionSession("content:write");
  if (!session) return { status: "error", message: "无权生成内容初稿。" };
  const parsed = contentAgentRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { status: "error", message: parsed.error.issues[0]?.message ?? "内容请求格式不正确。" };
  try {
    const rawProjectId = formData.get("projectId");
    const projectId =
      rawProjectId === null || rawProjectId === ""
        ? undefined
        : z.uuid("项目标识无效。").parse(rawProjectId);
    if (projectId) await assertWorkspaceProjectKind(projectId, "marketing", session.user.id);
    const product = (await listReadyProductContentSources(projectId)).find(
      (candidate) => candidate.id === parsed.data.productId,
    );
    const selected = product?.factOptions.find((fact) => fact.path === parsed.data.factPath);
    const productName = product?.factOptions.find((fact) => fact.path === "product.product_name");
    if (!product || !selected || !productName)
      throw new Error("只能引用仍处于 Product Ready 的已核验字段。");
    const verifiedFacts = [productName, selected]
      .filter(
        (fact, index, facts) => facts.findIndex((other) => other.path === fact.path) === index,
      )
      .map((fact) => ({ field: fact.path, value: fact.value, evidenceRef: fact.evidenceRef }));
    const draft = await generateMarketingContent({
      model: createProductAgentModel(await resolveProductAgentModelConfig()),
      contentType: parsed.data.contentType,
      objective: parsed.data.objective,
      targetCustomer: parsed.data.targetCustomer,
      verifiedFacts,
    });
    return { status: "success", message: "AI 初稿已生成；请人工核对后再创建待审内容。", draft };
  } catch (error) {
    return actionError(error, "无法生成内容初稿。");
  }
}
