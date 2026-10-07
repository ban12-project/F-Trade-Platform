"use server";

import { eq } from "drizzle-orm";
import type { z } from "zod";
import { actionError, authorizedActionSession } from "@/lib/action-boundary";

import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { hasPermission } from "@/lib/authz";
import {
  type contentGenerationOutputSchema,
  generateMarketingContent,
} from "@/lib/content/generation";
import { listReadyProductContentSources } from "@/lib/content/store";
import { getDatabase } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { contentAgentRequestSchema } from "@/lib/form-schemas";
import { assertWorkspaceProjectKind } from "@/lib/workspace/store";

export type ContentAgentActionState = {
  status: "idle" | "success" | "error";
  message: string;
  draft?: z.infer<typeof contentGenerationOutputSchema>;
};
async function assertGenerationAccess(projectId: string, actorId: string) {
  const [actor] = await getDatabase()
    .select({ role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, actorId));
  if (!actor || actor.banned || !hasPermission(actor.role, "content:write"))
    throw new Error("当前账号不可用或无权生成内容初稿。");
  await assertWorkspaceProjectKind(projectId, "marketing", actorId);
}
async function selectedProductFacts(projectId: string, productId: string, factPath: string) {
  const product = (await listReadyProductContentSources(projectId, productId))[0];
  const selected = product?.factOptions.find((fact) => fact.path === factPath);
  const productName = product?.factOptions.find((fact) => fact.path === "product.product_name");
  if (!product || !selected || !productName)
    throw new Error("只能引用仍处于 Product Ready 的已核验字段。");
  return [productName, selected]
    .filter((fact, index, facts) => facts.findIndex((other) => other.path === fact.path) === index)
    .map((fact) => ({ field: fact.path, value: fact.value, evidenceRef: fact.evidenceRef }));
}
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
    const { projectId, productId, factPath } = parsed.data;
    await assertGenerationAccess(projectId, session.user.id);
    const verifiedFacts = await selectedProductFacts(projectId, productId, factPath);
    let draft: z.infer<typeof contentGenerationOutputSchema>;
    try {
      draft = await generateMarketingContent({
        model: createProductAgentModel(await resolveProductAgentModelConfig()),
        contentType: parsed.data.contentType,
        objective: parsed.data.objective,
        targetCustomer: parsed.data.targetCustomer,
        verifiedFacts,
      });
    } catch {
      // Provider/configuration/output failures can contain private connection details.
      // Keep controlled authorization and fact-change messages separate.
      return {
        status: "error",
        message: "AI 初稿生成失败，请稍后重试或手动填写；如仍失败，请管理员检查模型连接。",
      };
    }
    // Model calls can outlive membership, session or fact changes. Do not return an old
    // protected result after its requesting actor or product source loses eligibility.
    const currentSession = await authorizedActionSession("content:write");
    if (!currentSession || currentSession.user.id !== session.user.id)
      throw new Error("生成期间权限已变化，未返回内容初稿。请重新登录并确认项目权限。");
    await assertGenerationAccess(projectId, session.user.id);
    const currentFacts = await selectedProductFacts(projectId, productId, factPath);
    if (JSON.stringify(currentFacts) !== JSON.stringify(verifiedFacts))
      throw new Error("生成期间产品事实已更新，未返回旧初稿。请按当前资料重新生成。");
    return { status: "success", message: "AI 初稿已生成；请人工核对后再创建待审内容。", draft };
  } catch (error) {
    return actionError(error, "无法生成内容初稿。");
  }
}
