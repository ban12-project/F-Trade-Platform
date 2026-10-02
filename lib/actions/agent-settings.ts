"use server";
import { actionError, authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";

import { saveProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { productAgentModelSettingsSchema } from "@/lib/form-schemas";

export type AgentSettingsActionState = {
  status: "idle" | "success" | "error";
  message: string;
  savedConfigId?: string;
};

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveProductAgentModelSettingsAction(
  _previousState: AgentSettingsActionState,
  formData: FormData,
): Promise<AgentSettingsActionState> {
  const session = await authorizedActionSession("settings:manage");
  if (!session) {
    return { status: "error", message: "无权修改 Agent 配置。" };
  }
  const parsed = productAgentModelSettingsSchema.safeParse({
    configId: formValue(formData, "configId"),
    name: formValue(formData, "name"),
    isDefault: formData.get("isDefault") === "true",
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
    const savedConfigId = await saveProductAgentModelSettings({
      ...parsed.data,
      configId: parsed.data.configId || undefined,
      headers: parsed.data.headersJson ? JSON.parse(parsed.data.headersJson) : {},
      apiKey: parsed.data.apiKey || undefined,
      authToken: parsed.data.authToken || undefined,
      actorId: session.user.id,
    });
    refreshWorkspace();
    return {
      status: "success",
      message: "Agent 模型配置已保存。密钥不会显示或返回给浏览器。",
      savedConfigId,
    };
  } catch (error) {
    return actionError(error, "无法保存 Agent 配置。");
  }
}
