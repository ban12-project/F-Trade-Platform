import { z } from "zod";
import { modelProviderSchema } from "@/lib/ai/model-provider-schema";

const optionalProviderText = z.string().trim().max(2_000, "字段不能超过 2000 个字符。");

export const productAgentModelSettingsSchema = z
  .object({
    configId: z.string().trim().max(120, "模型配置标识无效。"),
    name: z.string().trim().min(1, "请填写配置名称。").max(120, "配置名称不能超过 120 个字符。"),
    isDefault: z.boolean(),
    provider: modelProviderSchema,
    model: z.string().trim().min(1, "请填写模型名称。").max(240, "模型名称不能超过 240 个字符。"),
    baseUrl: z
      .string()
      .trim()
      .max(2_000, "端点不能超过 2000 个字符。")
      .refine(
        (value) => !value || /^https?:\/\//.test(value),
        "端点必须以 http:// 或 https:// 开头。",
      ),
    headersJson: z
      .string()
      .trim()
      .max(8_000, "请求 headers 不能超过 8000 个字符。")
      .superRefine((value, context) => {
        if (!value) return;
        try {
          const parsed: unknown = JSON.parse(value);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed) ||
            Object.values(parsed).some((item) => typeof item !== "string")
          ) {
            context.addIssue({
              code: "custom",
              message: "请求 headers 必须是值为字符串的 JSON 对象。",
            });
          }
          if (
            Object.keys(parsed as Record<string, unknown>).some((key) =>
              /^(authorization|x-api-key|api-key|x-goog-api-key)$/i.test(key),
            )
          ) {
            context.addIssue({
              code: "custom",
              message: "请使用上方加密凭据字段，不要在自定义 headers 中保存认证信息。",
            });
          }
        } catch {
          context.addIssue({ code: "custom", message: "请求 headers 必须是有效的 JSON 对象。" });
        }
      }),
    providerName: optionalProviderText,
    organization: optionalProviderText,
    project: optionalProviderText,
    apiKey: z.string().trim().max(8_000, "API key 不能超过 8000 个字符。"),
    authToken: z.string().trim().max(8_000, "Auth token 不能超过 8000 个字符。"),
    clearApiKey: z.boolean(),
    clearAuthToken: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.provider === "openai-compatible" && !value.baseUrl) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "OpenAI-compatible provider 必须填写 Base URL。",
      });
    }
  });
