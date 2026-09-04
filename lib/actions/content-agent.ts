"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { AiSdkStructuredGenerator } from "@/lib/ai/structured-generator";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { listReadyProductContentSources } from "@/lib/content/store";
import { contentAgentRequestSchema } from "@/lib/form-schemas";
import { assertWorkspaceProjectKind } from "@/lib/workspace/store";

const outputSchema = z.object({
  hook: z.string().min(1).max(500),
  body: z.string().min(1).max(4_000),
  callToAction: z.string().min(1).max(500),
  hashtags: z.array(z.string().min(1)).max(12),
  visualInstruction: z.string().min(1).max(4_000),
});

export type ContentAgentActionState = { status: "idle" | "success" | "error"; message: string; draft?: z.infer<typeof outputSchema> };
export async function generateContentDraftAction(_previous: ContentAgentActionState, formData: FormData): Promise<ContentAgentActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "content:write")) return { status: "error", message: "无权生成内容初稿。" };
  const parsed = contentAgentRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "内容请求格式不正确。" };
  try {
    const rawProjectId = formData.get("projectId");
    const projectId = rawProjectId === null || rawProjectId === "" ? undefined : z.uuid("项目标识无效。").parse(rawProjectId);
    if (projectId) await assertWorkspaceProjectKind(projectId, "marketing", session.user.id);
    const product = (await listReadyProductContentSources(projectId)).find((candidate) => candidate.id === parsed.data.productId);
    const selected = product?.factOptions.find((fact) => fact.path === parsed.data.factPath);
    const productName = product?.factOptions.find((fact) => fact.path === "product.product_name");
    if (!product || !selected || !productName) throw new Error("只能引用仍处于 Product Ready 的已核验字段。");
    const verifiedFacts = [productName, selected].filter((fact, index, facts) => facts.findIndex((other) => other.path === fact.path) === index).map((fact) => ({ field: fact.path, value: fact.value, evidenceRef: fact.evidenceRef }));
    const draft = await new AiSdkStructuredGenerator().generate({ model: createProductAgentModel(await resolveProductAgentModelConfig()), schema: outputSchema, schemaName: "content_marketing_draft", task: `Write an English ${parsed.data.contentType} B2B marketing draft. Objective: ${parsed.data.objective}. Target customer: ${parsed.data.targetCustomer}. Use only the supplied verified facts. Do not make claims about any absent engineering or commercial fact. Visual instruction must be non-engineering and must not imply product geometry, dimensions, materials, or part count.`, verifiedFacts });
    return { status: "success", message: "AI 初稿已生成；请人工核对后再创建待审内容。", draft };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法生成内容初稿。" };
  }
}
