import { z } from "zod";

const privateAssetRef = z.string().trim().regex(/^(?:asset|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i, "素材引用无效。");
const claimRef = z.string().trim().regex(/^(?:product|specifications|commercial)\.[a-z_]+$/, "产品事实引用无效。");
const editingPlatformSchema = z.enum(["facebook", "instagram", "x", "youtube", "tiktok"]);
const evidenceRef = z.string().trim().regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "请填写素材权利证据引用。");
const internetSearchQuery = z.string().trim().min(2, "检索词至少需要两个字符。").max(120, "检索词不能超过 120 个字符。");
const protectedFactLanguage = /\d|\boe[m]?\b|\b(?:diameter|dimension|spline|material|certif(?:ied|ication)|lifetime|moq|lead[ -]?time|fit(?:s|ment)?|compatib(?:le|ility)|price|usd|eur|rmb|days?|mm|kg)\b|尺寸|直径|花键|材料|认证|寿命|起订|交期|适配|兼容|价格/i;

const creativeMarketingText = (maximum: number, tooLongMessage: string) => z.string().trim().min(1).max(maximum, tooLongMessage).refine(
  (value) => !protectedFactLanguage.test(value),
  "创意文案不能包含工程或商业事实；请改用核验事实字段。",
);

const marketingVideoCreationShape = {
  projectId: z.uuid("项目标识无效。"),
  productId: z.uuid("产品记录标识无效。"),
  factPath: claimRef,
  objective: z.string().trim().min(1, "请填写视频目标。").max(2_000),
  targetAudience: z.string().trim().min(1, "请填写目标受众。").max(240),
  platform: editingPlatformSchema,
} as const;

/** Existing browser-upload form contract. */
export const createMarketingVideoDraftFormSchema = z.object({
  ...marketingVideoCreationShape,
  rightsEvidenceRef: evidenceRef,
}).strict();

/** Separate contract for reusing independently approved ProductMedia. */
export const createMarketingVideoFromProductMediaSchema = z.object({
  ...marketingVideoCreationShape,
  sourceMode: z.literal("product_media"),
  productMediaIds: z.array(z.uuid("产品媒体标识无效。"))
    .min(1, "至少选择一个已审核产品媒体。")
    .max(3, "MVP1 最多选择三个产品媒体。"),
  rightsEvidenceRef: z.literal(""),
}).strict().superRefine((value, context) => {
  if (new Set(value.productMediaIds).size !== value.productMediaIds.length) {
    context.addIssue({ code: "custom", path: ["productMediaIds"], message: "产品媒体不能重复选择。" });
  }
});

/** Internet results are re-resolved by provider ID; browser-supplied URLs are never imported. */
export const createMarketingVideoFromInternetSchema = z.object({
  ...marketingVideoCreationShape,
  sourceMode: z.literal("internet_search"),
  internetSearchQuery,
  internetMediaIds: z.array(z.string().regex(/^wikimedia:\d+$/, "互联网素材标识无效。"))
    .min(1, "至少选择一个互联网素材。")
    .max(3, "每条视频最多选择三个互联网素材。"),
  rightsEvidenceRef: z.literal(""),
}).strict().superRefine((value, context) => {
  if (new Set(value.internetMediaIds).size !== value.internetMediaIds.length) {
    context.addIssue({ code: "custom", path: ["internetMediaIds"], message: "互联网素材不能重复选择。" });
  }
});

/** Shared React Hook Form contract for choosing one of the three source modes. */
export const createMarketingVideoUiFormSchema = z.object({
  ...marketingVideoCreationShape,
  sourceMode: z.enum(["product_media", "upload", "internet_search"]),
  productMediaIds: z.array(z.uuid("产品媒体标识无效。")).max(3, "MVP1 最多选择三个产品媒体。"),
  rightsEvidenceRef: z.string().trim().max(140, "素材权利证据引用过长。"),
  internetSearchQuery: z.string().trim().max(120, "检索词不能超过 120 个字符。"),
  internetMediaIds: z.array(z.string().regex(/^wikimedia:\d+$/, "互联网素材标识无效。")).max(3, "每条视频最多选择三个互联网素材。"),
}).strict().superRefine((value, context) => {
  if (value.sourceMode === "upload") {
    if (!evidenceRef.safeParse(value.rightsEvidenceRef).success) {
      context.addIssue({ code: "custom", path: ["rightsEvidenceRef"], message: "上传新素材时必须填写私有权利证据引用。" });
    }
    if (value.productMediaIds.length) {
      context.addIssue({ code: "custom", path: ["productMediaIds"], message: "上传模式不能同时选择已有产品媒体。" });
    }
    if (value.internetMediaIds.length) {
      context.addIssue({ code: "custom", path: ["internetMediaIds"], message: "上传模式不能同时选择互联网素材。" });
    }
    return;
  }

  if (value.sourceMode === "internet_search") {
    if (!internetSearchQuery.safeParse(value.internetSearchQuery).success) {
      context.addIssue({ code: "custom", path: ["internetSearchQuery"], message: "请先输入至少两个字符并检索素材。" });
    }
    if (!value.internetMediaIds.length) {
      context.addIssue({ code: "custom", path: ["internetMediaIds"], message: "请从检索结果中选择 1–3 个素材。" });
    }
    if (new Set(value.internetMediaIds).size !== value.internetMediaIds.length) {
      context.addIssue({ code: "custom", path: ["internetMediaIds"], message: "互联网素材不能重复选择。" });
    }
    if (value.productMediaIds.length) {
      context.addIssue({ code: "custom", path: ["productMediaIds"], message: "互联网检索模式不能同时选择已有产品媒体。" });
    }
    if (value.rightsEvidenceRef) {
      context.addIssue({ code: "custom", path: ["rightsEvidenceRef"], message: "互联网测试素材由服务端自动记录来源。" });
    }
    return;
  }

  if (!value.productMediaIds.length) {
    context.addIssue({ code: "custom", path: ["productMediaIds"], message: "至少选择一个已审核产品媒体。" });
  }
  if (new Set(value.productMediaIds).size !== value.productMediaIds.length) {
    context.addIssue({ code: "custom", path: ["productMediaIds"], message: "产品媒体不能重复选择。" });
  }
  if (value.rightsEvidenceRef) {
    context.addIssue({ code: "custom", path: ["rightsEvidenceRef"], message: "复用模式由服务端读取逐素材权利证据。" });
  }
  if (value.internetMediaIds.length) {
    context.addIssue({ code: "custom", path: ["internetMediaIds"], message: "复用模式不能同时选择互联网素材。" });
  }
});

export const marketingVideoCaptionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("creative"), text: creativeMarketingText(120, "单个片段字幕不能超过 120 个字符。") }).strict(),
  z.object({ kind: z.literal("verified_fact"), claimRef }).strict(),
]);

export const safeAiCreativeCaptions = [
  "See the product in detail",
  "For distributor inquiries",
  "Ask our team for details",
] as const;
export const safeAiCtaTexts = [
  "Contact our sales team",
  "Request product details",
  "Start a distributor inquiry",
] as const;

/**
 * Keep the model-facing caption contract as one flat object. Some structured-output
 * providers reject the `oneOf` emitted by Zod discriminated unions before the
 * response reaches our runtime validator. The compiler below converts this
 * transport shape into the governed domain union.
 */
const marketingVideoAiCaptionSchema = z.object({
  kind: z.enum(["none", "creative", "verified_fact"]),
  text: z.enum(["", ...safeAiCreativeCaptions]),
  claimRef: z.string().trim().max(120),
}).strict().superRefine((caption, context) => {
  if (caption.kind === "none" && (caption.text || caption.claimRef)) {
    context.addIssue({ code: "custom", message: "无字幕时文字和事实引用必须为空。" });
  }
  if (caption.kind === "creative" && (!caption.text || caption.claimRef)) {
    context.addIssue({ code: "custom", message: "创意字幕必须使用允许的文字且不能引用产品事实。" });
  }
  if (caption.kind === "verified_fact" && (caption.text || !claimRef.safeParse(caption.claimRef).success)) {
    context.addIssue({ code: "custom", message: "事实字幕必须只提供有效的产品事实引用。" });
  }
});

export const marketingVideoClipSchema = z.object({
  clipId: z.string().trim().regex(/^clip-[a-z0-9][a-z0-9_-]{2,80}$/i, "片段标识无效。"),
  assetRef: privateAssetRef,
  mediaType: z.enum(["image", "video"]),
  trimStartMs: z.number().int().min(0),
  durationMs: z.number().int().min(1_000, "片段至少 1 秒。").max(10_000, "单个片段不能超过 10 秒。"),
  fitMode: z.enum(["contain", "cover"]),
  audioMode: z.enum(["muted", "source"]),
  caption: marketingVideoCaptionSchema,
}).strict().superRefine((clip, context) => {
  if (clip.mediaType === "image" && clip.trimStartMs !== 0) {
    context.addIssue({ code: "custom", path: ["trimStartMs"], message: "图片素材不能设置起始裁剪时间。" });
  }
  if (clip.mediaType === "image" && clip.audioMode !== "muted") {
    context.addIssue({ code: "custom", path: ["audioMode"], message: "图片素材没有可保留的原声。" });
  }
});

const marketingVideoDraftV2Schema = z.object({
  version: z.literal(2),
  platform: editingPlatformSchema,
  clips: z.array(marketingVideoClipSchema).min(1, "至少需要一个片段。").max(3, "MVP1 最多支持三个片段。"),
  ctaText: z.literal("").or(creativeMarketingText(40, "CTA 不能超过 40 个字符。")),
}).strict().superRefine((draft, context) => {
  const totalDurationMs = draft.clips.reduce((total, clip) => total + clip.durationMs, 0);
  if (totalDurationMs > 15_000) {
    context.addIssue({ code: "custom", path: ["clips"], message: "整条营销视频不能超过 15 秒。" });
  }
  const clipIds = new Set<string>();
  for (const [index, clip] of draft.clips.entries()) {
    if (clipIds.has(clip.clipId)) context.addIssue({ code: "custom", path: ["clips", index, "clipId"], message: "片段标识不能重复。" });
    clipIds.add(clip.clipId);
  }
});

const legacyMarketingVideoClipSchema = z.object({
  clipId: z.string().trim().regex(/^clip-[a-z0-9][a-z0-9_-]{2,80}$/i, "片段标识无效。"),
  assetRef: privateAssetRef,
  mediaType: z.enum(["image", "video"]),
  trimStartMs: z.number().int().min(0),
  durationMs: z.number().int().min(1_000).max(10_000),
  fitMode: z.enum(["contain", "cover"]),
  audioMode: z.enum(["muted", "source"]),
  subtitle: z.string().trim().max(120),
  claimRefs: z.array(claimRef).max(24),
}).strict().superRefine((clip, context) => {
  if (clip.subtitle && clip.claimRefs.length > 1) {
    context.addIssue({ code: "custom", path: ["claimRefs"], message: "旧剪辑字幕同时引用多个事实，无法安全迁移；请重新生成初稿。" });
  }
  if (clip.mediaType === "image" && clip.trimStartMs !== 0) {
    context.addIssue({ code: "custom", path: ["trimStartMs"], message: "图片素材不能设置起始裁剪时间。" });
  }
  if (clip.mediaType === "image" && clip.audioMode !== "muted") {
    context.addIssue({ code: "custom", path: ["audioMode"], message: "图片素材没有可保留的原声。" });
  }
});

const legacyMarketingVideoDraftSchema = z.object({
  version: z.literal(1),
  platform: editingPlatformSchema,
  clips: z.array(legacyMarketingVideoClipSchema).min(1).max(3),
  ctaText: z.string().trim().max(40),
}).strict().transform((draft) => marketingVideoDraftV2Schema.parse({
  version: 2,
  platform: draft.platform,
  clips: draft.clips.map(({ subtitle, claimRefs, ...clip }) => ({
    ...clip,
    caption: !subtitle
      ? { kind: "none" as const }
      : claimRefs[0]
        ? { kind: "verified_fact" as const, claimRef: claimRefs[0] }
        : { kind: "creative" as const, text: subtitle },
  })),
  ctaText: draft.ctaText,
}));

/** Reads safe legacy v1 drafts but always returns the governed v2 shape. */
export const marketingVideoDraftSchema = z.union([marketingVideoDraftV2Schema, legacyMarketingVideoDraftSchema]);

export const marketingVideoAiDraftSchema = z.object({
  clips: z.array(z.object({
    shotCandidateId: z.string().trim().regex(/^shot-[0-9]{3}-[0-9]{3}$/),
    durationMs: z.number().int().min(1_000).max(10_000),
    fitMode: z.enum(["contain", "cover"]),
    audioMode: z.enum(["muted", "source"]),
    caption: marketingVideoAiCaptionSchema,
  }).strict()).min(1).max(3),
  ctaText: z.enum(["", ...safeAiCtaTexts]),
}).strict();

export type MarketingVideoClip = z.infer<typeof marketingVideoClipSchema>;
export type MarketingVideoCaption = z.infer<typeof marketingVideoCaptionSchema>;
export type MarketingVideoDraft = z.infer<typeof marketingVideoDraftSchema>;
export type MarketingVideoAiDraft = z.infer<typeof marketingVideoAiDraftSchema>;

export function marketingVideoDurationMs(draft: MarketingVideoDraft) {
  return draft.clips.reduce((total, clip) => total + clip.durationMs, 0);
}
