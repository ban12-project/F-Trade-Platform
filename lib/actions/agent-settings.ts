"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { productAgentModelSettingsSchema } from "@/lib/form-schemas";
import { saveProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";

export type AgentSettingsActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveProductAgentModelSettingsAction(
  _previousState: AgentSettingsActionState,
  formData: FormData,
): Promise<AgentSettingsActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "settings:manage")) {
    return { status: "error", message: "无权修改 Agent 配置。" };
  }
  const parsed = productAgentModelSettingsSchema.safeParse({
    provider: formValue(formData, "provider"),
    model: formValue(formData, "model"),
    baseUrl: formValue(formData, "baseUrl"),
    headersJson: formValue(formData, "headersJson"),
    providerName: formValue(formData, "providerName"),
    organization: formValue(formData, "organization"),
    project: formValue(formData, "project"),
    apiKey: formValue(formData, "apiKey"),
    authToken: formValue(formData, "authToken"),
    clearApiKey: formData.get("clearApiKey") === "true",
    clearAuthToken: formData.get("clearAuthToken") === "true",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "配置无效。" };
  }
  try {
    await saveProductAgentModelSettings({
      ...parsed.data,
      headers: parsed.data.headersJson ? JSON.parse(parsed.data.headersJson) : {},
      apiKey: parsed.data.apiKey || undefined,
      authToken: parsed.data.authToken || undefined,
      actorId: session.user.id,
    });
    revalidatePath("/workspace");
    return { status: "success", message: "Agent 模型配置已保存。密钥不会显示或返回给浏览器。" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法保存 Agent 配置。",
    };
  }
}
