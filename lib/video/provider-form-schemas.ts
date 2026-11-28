import { z } from "zod";
import {
  videoAspectRatioSchema,
  videoCapabilitySchema,
  videoProviderIdSchema,
} from "@/lib/video/provider-capabilities";

/** Shared by the browser form and its Server Action; credentials are write-only. */
export const videoProviderModelSettingsFormSchema = z
  .object({
    provider: videoProviderIdSchema,
    providerEnabled: z.boolean(),
    credential: z.string().trim().max(8_000, "凭据不能超过 8000 个字符。"),
    clearCredential: z.boolean(),
    maximumConcurrentJobs: z.coerce
      .number()
      .int()
      .min(1, "并发数至少为 1。")
      .max(100, "并发数不能超过 100。"),
    maximumAttempts: z.coerce
      .number()
      .int()
      .min(1, "重试次数至少为 1。")
      .max(10, "重试次数不能超过 10。"),
    budgetLimitCents: z.coerce.number().int().min(1, "预算上限必须大于 0。"),
    budgetCommittedCents: z.coerce.number().int().min(0, "已承诺预算不能为负数。"),
    modelId: z.string().trim().min(1, "请填写模型标识。").max(240),
    capabilities: z.string().trim().min(1, "至少填写一种能力。"),
    aspectRatios: z.string().trim().min(1, "至少填写一种画幅。"),
    durationMinimumSeconds: z.coerce.number().int().min(1, "最短时长至少为 1 秒。"),
    durationMaximumSeconds: z.coerce.number().int().min(1, "最长时长至少为 1 秒。"),
    resolutions: z.string().trim().min(1, "至少填写一种分辨率。"),
    verifiedAt: z.string().trim(),
    verificationRef: z.string().trim().max(240),
    modelEnabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.durationMaximumSeconds < value.durationMinimumSeconds) {
      context.addIssue({
        code: "custom",
        path: ["durationMaximumSeconds"],
        message: "最长时长不能小于最短时长。",
      });
    }
    if (value.budgetCommittedCents > value.budgetLimitCents) {
      context.addIssue({
        code: "custom",
        path: ["budgetCommittedCents"],
        message: "已承诺预算不能超过上限。",
      });
    }
    if (value.modelEnabled && (!value.verifiedAt || !value.verificationRef)) {
      context.addIssue({
        code: "custom",
        path: ["modelEnabled"],
        message: "启用模型前必须填写验证时间和证据引用。",
      });
    }
  });

export const videoJobSubmissionFormSchema = z
  .object({
    videoId: z.uuid("视频计划标识无效。"),
    provider: videoProviderIdSchema,
    modelId: z.string().trim().min(1, "请选择已验证模型。").max(240),
    requiredCapabilities: z.array(videoCapabilitySchema).min(1),
    aspectRatio: videoAspectRatioSchema,
    durationSeconds: z.coerce.number().int().positive().max(30),
    resolution: z
      .string()
      .trim()
      .regex(/^\d{3,5}x\d{3,5}$/),
    expectedCostCents: z.coerce.number().int().positive().max(100_000_000),
  })
  .strict();
