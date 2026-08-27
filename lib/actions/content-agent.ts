"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { AiSdkStructuredGenerator } from "@/lib/ai/structured-generator";
import { auth } from "@/lib/auth";
import { listReadyProductContentSources } from "@/lib/content/store";
import { contentAgentRequestSchema } from "@/lib/form-schemas";

const outputSchema = z.object({
  hook: z.string().min(1).max(500),
  body: z.string().min(1).max(4_000),
  callToAction: z.string().min(1).max(500),
  hashtags: z.array(z.string().min(1)).max(12),
  visualInstruction: z.string().min(1).max(4_000),
});

export type ContentAgentActionState = { status: "idle" | "success" | "error"; message: string; draft?: z.infer<typeof outputSchema> };
export const initialContentAgentActionState: ContentAgentActionState = { status: "idle", message: "" };

export async function generateContentDraftAction(_previous: ContentAgentActionState, formData: FormData): Promise<ContentAgentActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return { status: "error", message: "无权生成内容初稿。" };
  const parsed = contentAgentRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "内容请求格式不正确。" };
  try {
    const product = (await listReadyProductContentSources()).find((candidate) => candidate.id === parsed.data.productId);
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
