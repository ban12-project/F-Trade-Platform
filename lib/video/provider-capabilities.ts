import { z } from "zod";

/**
 * This catalogue is an allow-list, not a claim that every listed provider is
 * configured or available in a deployment. A model becomes selectable only
 * after an administrator records a successful, current verification.
 */
export const videoProviderIdSchema = z.enum([
  "alibaba",
  "bytedance",
  "fal",
  "google",
  "google-vertex",
  "kling",
  "replicate",
  "xai",
]);
export type VideoProviderId = z.infer<typeof videoProviderIdSchema>;

export const videoCapabilitySchema = z.enum([
  "text-to-video",
  "image-to-video",
  "reference-to-video",
  "video-editing",
  "audio-generation",
]);
export type VideoCapability = z.infer<typeof videoCapabilitySchema>;

export const videoAspectRatioSchema = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
export type VideoAspectRatio = z.infer<typeof videoAspectRatioSchema>;

export const videoModelCapabilitySchema = z.object({
  provider: videoProviderIdSchema,
  modelId: z.string().trim().min(1).max(240),
  capabilities: z.array(videoCapabilitySchema).min(1).max(5),
  aspectRatios: z.array(videoAspectRatioSchema).min(1).max(6),
  durationSeconds: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).refine((value) => value.min <= value.max),
  resolutions: z.array(z.string().trim().regex(/^\d{3,5}x\d{3,5}$/)).min(1).max(12),
  verifiedAt: z.coerce.date().nullable(),
  verificationRef: z.string().trim().max(240).nullable(),
  enabled: z.boolean(),
}).strict().superRefine((model, context) => {
  if (model.enabled && (!model.verifiedAt || !model.verificationRef)) {
    context.addIssue({ code: "custom", path: ["enabled"], message: "启用视频模型前必须记录可复核的验证时间和证据引用。" });
  }
  if (model.verifiedAt && model.verifiedAt.getTime() > Date.now()) {
    context.addIssue({ code: "custom", path: ["verifiedAt"], message: "验证时间不能在未来。" });
  }
});
export type VideoModelCapability = z.infer<typeof videoModelCapabilitySchema>;

export const videoGenerationRequestSchema = z.object({
  provider: videoProviderIdSchema,
  modelId: z.string().trim().min(1).max(240),
  requiredCapabilities: z.array(videoCapabilitySchema).min(1).max(5),
  aspectRatio: videoAspectRatioSchema,
  durationSeconds: z.number().int().positive(),
  resolution: z.string().trim().regex(/^\d{3,5}x\d{3,5}$/),
}).strict();

export function selectVerifiedVideoModel(
  catalog: readonly VideoModelCapability[],
  request: z.infer<typeof videoGenerationRequestSchema>,
): VideoModelCapability {
  const parsed = videoGenerationRequestSchema.parse(request);
  const candidate = catalog.find((model) => model.provider === parsed.provider && model.modelId === parsed.modelId);
  if (!candidate) throw new Error("视频模型未在能力注册表中登记。");
  const model = videoModelCapabilitySchema.parse(candidate);
  if (!model.enabled || !model.verifiedAt || !model.verificationRef) {
    throw new Error("视频模型尚未通过验证或未启用。");
  }
  if (!parsed.requiredCapabilities.every((capability) => model.capabilities.includes(capability))) {
    throw new Error("视频模型不满足所需生成能力。");
  }
  if (!model.aspectRatios.includes(parsed.aspectRatio)) throw new Error("视频模型不支持所需画幅比例。");
  if (parsed.durationSeconds < model.durationSeconds.min || parsed.durationSeconds > model.durationSeconds.max) {
    throw new Error("视频时长超出已验证模型能力范围。");
  }
  if (!model.resolutions.includes(parsed.resolution)) throw new Error("视频模型不支持所需分辨率。");
  return model;
}
