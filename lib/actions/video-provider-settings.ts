"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { videoProviderModelSettingsFormSchema } from "@/lib/form-schemas";
import { assertVideoGenerationEnabled } from "@/lib/video/mvp-policy";
import { videoAspectRatioSchema, videoCapabilitySchema } from "@/lib/video/provider-capabilities";
import { saveVideoProviderModelSettings } from "@/lib/video/provider-config-store";

export type VideoProviderSettingsActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function list(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function saveVideoProviderModelSettingsAction(
  _previousState: VideoProviderSettingsActionState,
  formData: FormData,
): Promise<VideoProviderSettingsActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "settings:manage")) {
    return { status: "error", message: "无权修改视频提供商配置。" };
  }
  try {
    assertVideoGenerationEnabled();
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "视频生成能力当前未启用。",
    };
  }
  const parsed = videoProviderModelSettingsFormSchema.safeParse({
    provider: text(formData, "provider"),
    providerEnabled: formData.get("providerEnabled") === "true",
    credential: text(formData, "credential"),
    clearCredential: formData.get("clearCredential") === "true",
    maximumConcurrentJobs: text(formData, "maximumConcurrentJobs"),
    maximumAttempts: text(formData, "maximumAttempts"),
    budgetLimitCents: text(formData, "budgetLimitCents"),
    budgetCommittedCents: text(formData, "budgetCommittedCents"),
    modelId: text(formData, "modelId"),
    capabilities: text(formData, "capabilities"),
    aspectRatios: text(formData, "aspectRatios"),
    durationMinimumSeconds: text(formData, "durationMinimumSeconds"),
    durationMaximumSeconds: text(formData, "durationMaximumSeconds"),
    resolutions: text(formData, "resolutions"),
    verifiedAt: text(formData, "verifiedAt"),
    verificationRef: text(formData, "verificationRef"),
    modelEnabled: formData.get("modelEnabled") === "true",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "视频提供商配置无效。" };
  }
  try {
    const value = parsed.data;
    await saveVideoProviderModelSettings({
      provider: value.provider,
      providerEnabled: value.providerEnabled,
      credential: value.credential || undefined,
      clearCredential: value.clearCredential,
      maximumConcurrentJobs: value.maximumConcurrentJobs,
      maximumAttempts: value.maximumAttempts,
      budgetLimitCents: value.budgetLimitCents,
      budgetCommittedCents: value.budgetCommittedCents,
      runtimeSettings: {},
      model: {
        provider: value.provider,
        modelId: value.modelId,
        capabilities: videoCapabilitySchema.array().min(1).max(5).parse(list(value.capabilities)),
        aspectRatios: videoAspectRatioSchema.array().min(1).max(6).parse(list(value.aspectRatios)),
        durationSeconds: { min: value.durationMinimumSeconds, max: value.durationMaximumSeconds },
        resolutions: list(value.resolutions),
        verifiedAt: value.verifiedAt ? new Date(value.verifiedAt) : null,
        verificationRef: value.verificationRef || null,
        enabled: value.modelEnabled,
      },
      actorId: session.user.id,
    });
    revalidatePath("/workspace", "layout");
    return { status: "success", message: "视频提供商配置已保存；凭据不会显示或返回到浏览器。" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法保存视频提供商配置。",
    };
  }
}
