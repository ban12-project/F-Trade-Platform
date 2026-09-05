import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "请输入邮箱地址。")
  .email("请输入有效的邮箱地址。");

export const invitationFormSchema = z.object({
  email: emailSchema,
});

export const authFormSchema = z.object({
  email: emailSchema,
  otp: z.string().trim().min(1, "请输入邮箱验证码。"),
});

const privateReference = z
  .string()
  .trim()
  .regex(
    /^(?:source|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i,
    "请填写脱敏的私有引用，例如 evidence-product-001。",
  );

const optionalCatalogText = z.string().trim().max(240, "字段不能超过 240 个字符。");

export const productCatalogFormSchema = z.object({
  productName: z
    .string()
    .trim()
    .min(1, "请填写产品名称。")
    .max(160, "产品名称不能超过 160 个字符。"),
  productType: z.enum(["clutch_disc", "clutch_cover", "release_bearing", "clutch_kit"]),
  internalSku: z
    .string()
    .trim()
    .min(1, "请填写内部编号。")
    .max(120, "内部编号不能超过 120 个字符。"),
  oeNumbers: optionalCatalogText,
  application: optionalCatalogText,
  vehicleBrand: optionalCatalogText,
  vehicleModel: optionalCatalogText,
  clutchDiameterMm: z
    .string()
    .trim()
    .regex(/^$|^\d+(?:\.\d+)?$/, "盘径必须是正数。")
    .refine((value) => value === "" || Number(value) > 0, "盘径必须大于 0。"),
  splineCount: z
    .string()
    .trim()
    .regex(/^$|^[1-9]\d*$/, "花键数必须是正整数。"),
  splineSize: optionalCatalogText,
  frictionMaterial: optionalCatalogText,
  sourceRef: privateReference,
  evidenceRef: privateReference,
});

export const productReviewFormSchema = z
  .object({
    productId: z.uuid("产品记录标识无效。"),
    reviewedVersion: z
      .string()
      .regex(/^[1-9]\d*$/, "审核版本无效，请刷新后重试。")
      .refine((value) => Number.isSafeInteger(Number(value)), "审核版本无效。"),
    approvalId: z.uuid("审核请求标识无效，请刷新后重试。"),
    decision: z.enum(["approved", "rejected"]),
    evidenceRef: privateReference,
    notes: z.string().trim().max(2_000, "审核备注不能超过 2000 个字符。"),
  })
  .superRefine((value, context) => {
    if (value.decision === "rejected" && !value.notes)
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "退回产品事实时必须填写原因。",
      });
  });

/** Deliberately accepts pre-authorized, sanitized text only; raw factory files stay in private evidence storage. */
export const productAgentRunFormSchema = z
  .object({
    modelConfigId: z.string().trim().min(1, "请选择模型配置。").max(120, "模型配置标识无效。"),
    model: z.string().trim().min(1, "请选择模型。").max(240, "模型名称无效。"),
    sourceRef: privateReference.optional().or(z.literal("")),
    evidenceRef: privateReference.optional().or(z.literal("")),
    sourceText: z.string().trim().max(120_000, "资料文本不能超过 120000 个字符。"),
    hasUpload: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.hasUpload) return;
    if (!value.sourceRef)
      context.addIssue({ code: "custom", path: ["sourceRef"], message: "请填写来源引用。" });
    if (!value.evidenceRef)
      context.addIssue({ code: "custom", path: ["evidenceRef"], message: "请填写字段证据引用。" });
    if (value.sourceText.trim().length < 20)
      context.addIssue({
        code: "custom",
        path: ["sourceText"],
        message: "请粘贴至少 20 个字符的已授权资料文本。",
      });
  });

const contentText = z
  .string()
  .trim()
  .min(1, "此字段不能为空。")
  .max(4_000, "此字段不能超过 4000 个字符。");

const videoPrivateAssetReference = z
  .string()
  .trim()
  .regex(
    /^asset-[a-z0-9][a-z0-9_-]{2,120}$/i,
    "请填写脱敏的私有素材引用，例如 asset-product-001。",
  );
const videoPlatform = z.enum(["facebook", "instagram", "x", "youtube", "tiktok"]);

export const videoProjectDraftFormSchema = z
  .object({
    productId: z.uuid("产品记录标识无效。"),
    factPath: z
      .string()
      .trim()
      .regex(/^(?:product|specifications|commercial)\.[a-z_]+$/, "请选择已核验的产品字段。"),
    objective: contentText,
    targetAudience: z
      .string()
      .trim()
      .min(1, "请填写目标受众。")
      .max(240, "目标受众不能超过 240 个字符。"),
    scenePrompt: contentText,
    durationSeconds: z.coerce
      .number()
      .int("镜头时长必须是整数。")
      .min(1, "镜头时长至少 1 秒。")
      .max(30, "单个镜头不能超过 30 秒。"),
    platforms: z.array(videoPlatform).min(1, "至少选择一个目标平台。").max(5),
    assetRef: videoPrivateAssetReference.optional().or(z.literal("")),
    rightsEvidenceRef: privateReference.optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    if (value.assetRef && !value.rightsEvidenceRef) {
      context.addIssue({
        code: "custom",
        path: ["rightsEvidenceRef"],
        message: "引用已有素材时必须提供其权利证据。",
      });
    }
  });

export const contentDraftFormSchema = z.object({
  productId: z.uuid("产品记录标识无效。"),
  contentType: z.enum(["product", "factory_capability", "industry_knowledge"]),
  factPath: z
    .string()
    .trim()
    .regex(/^(?:product|specifications|commercial)\.[a-z_]+$/, "请选择已核验的产品字段。"),
  objective: contentText,
  targetCustomer: z
    .string()
    .trim()
    .min(1, "请填写目标客户。")
    .max(240, "目标客户不能超过 240 个字符。"),
  hook: z.string().trim().min(1, "请填写开场句。").max(500, "开场句不能超过 500 个字符。"),
  body: contentText,
  callToAction: z
    .string()
    .trim()
    .min(1, "请填写行动号召。")
    .max(500, "行动号召不能超过 500 个字符。"),
  hashtags: z.string().trim().max(500, "标签不能超过 500 个字符。"),
  visualInstruction: contentText,
});

export const contentAgentRequestSchema = contentDraftFormSchema.pick({
  productId: true,
  contentType: true,
  factPath: true,
  objective: true,
  targetCustomer: true,
});

const optionalRfqText = z.string().trim().max(240, "字段不能超过 240 个字符。");
export const rfqFormSchema = z.object({
  leadId: z.uuid("入站线索标识无效。").optional().or(z.literal("")),
  customerName: optionalRfqText,
  customerCompany: optionalRfqText,
  customerCountry: optionalRfqText,
  productType: z.enum(["clutch_disc", "clutch_cover", "release_bearing", "clutch_kit"]),
  oeNumber: optionalRfqText,
  vehicleBrand: optionalRfqText,
  vehicleModel: optionalRfqText,
  quantity: z
    .string()
    .trim()
    .regex(/^$|^[1-9]\d*$/, "数量必须是正整数。"),
  destination: optionalRfqText,
  evidenceRef: privateReference,
});

const positiveMoney = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,4})?$/, "单价必须是正数，最多四位小数。")
  .refine((value) => Number(value) > 0, "单价必须大于 0。");
const positiveIntegerText = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, "必须填写正整数。");

export const quotationDraftFormSchema = z.object({
  projectId: z.uuid("项目标识无效。"),
  quotationId: z.uuid("报价标识无效。").optional().or(z.literal("")),
  rfqId: z.uuid("请选择 RFQ Ready。"),
  productId: z.uuid("请选择 Product Ready 引用。"),
  unitPrice: positiveMoney,
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "币种必须是三位大写 ISO 代码。"),
  moq: positiveIntegerText,
  leadTimeDays: z.string().trim().regex(/^\d+$/, "交期天数必须是非负整数。"),
  paymentTerms: z.string().trim().min(1, "请填写付款条件。").max(500),
  validityDays: positiveIntegerText,
});

export const quotationDecisionFormSchema = z
  .object({
    projectId: z.uuid("项目标识无效。"),
    quotationId: z.uuid("报价标识无效。"),
    decision: z.enum(["approved", "rejected"]),
    evidenceRef: privateReference,
    notes: z.string().trim().max(2_000),
  })
  .superRefine((value, context) => {
    if (value.decision === "rejected" && !value.notes)
      context.addIssue({ code: "custom", path: ["notes"], message: "退回报价时必须填写原因。" });
  });

export const quotationSendFormSchema = z.object({
  projectId: z.uuid("项目标识无效。"),
  quotationId: z.uuid("报价标识无效。"),
  channelRef: z.string().trim().min(1, "请填写发送渠道。").max(240),
  externalRef: z.string().trim().min(1, "请填写外部发送凭证。").max(240),
});

export const followUpFormSchema = z
  .object({
    projectId: z.uuid("项目标识无效。"),
    leadId: z.uuid("线索标识无效。"),
    context: z.enum([
      "quote_sent_unread",
      "quote_sent_read_no_reply",
      "price_high",
      "purchase_later",
      "asks_sample",
      "asks_lead_time",
    ]),
    triggeredRules: z
      .array(
        z.enum([
          "active_inquiry",
          "provides_oe_number",
          "explicit_quantity",
          "target_quantity_range",
          "asks_sample",
          "asks_lead_time",
          "asks_payment_terms",
          "replies_again",
        ]),
      )
      .max(8),
    draft: z.string().trim().min(1, "请填写人工确认后的跟进内容。").max(4_000),
    confirmationRef: privateReference,
    nextFollowUpAt: z.string().trim().optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    if (value.nextFollowUpAt && Number.isNaN(Date.parse(value.nextFollowUpAt)))
      context.addIssue({ code: "custom", path: ["nextFollowUpAt"], message: "下次跟进时间无效。" });
  });

export const deliveryRequestFormSchema = z.object({
  projectId: z.uuid(),
  leadId: z.uuid(),
  evidenceRef: privateReference,
});
export const deliveryDecisionFormSchema = z
  .object({
    projectId: z.uuid(),
    confirmationId: z.uuid(),
    decision: z.enum(["confirmed", "rejected"]),
    evidenceRef: privateReference,
    leadTimeDays: z.string().trim(),
    notes: z.string().trim().max(2_000),
  })
  .superRefine((value, context) => {
    if (value.decision === "confirmed" && !/^\d+$/.test(value.leadTimeDays))
      context.addIssue({
        code: "custom",
        path: ["leadTimeDays"],
        message: "批准交期时必须填写非负整数天数。",
      });
    if (value.decision === "rejected" && !value.notes)
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "拒绝交期确认时必须填写原因。",
      });
  });

export const opportunityDecisionFormSchema = z.object({
  projectId: z.uuid(),
  leadId: z.uuid(),
  evidenceRef: privateReference,
});

export const inboundRoutingFormSchema = z
  .object({
    conversationId: z.string().trim().min(1, "入站会话标识无效。").max(160),
    mode: z.enum(["create", "link"]),
    projectId: z.uuid("请选择要关联的销售项目。").optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    if (value.mode === "link" && !value.projectId)
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "请选择要关联的销售项目。",
      });
  });

export const publicationConfirmationFormSchema = z.object({
  projectId: z.uuid(),
  contentRef: z.uuid("内容标识无效。"),
  format: z.enum(["text", "image", "video"]),
  channelRef: z.string().trim().min(1, "请选择已启用渠道。"),
  accountRef: z.string().trim().min(1, "请选择发布账户。"),
  confirmationRef: privateReference,
});

export const publicationResultSchema = z
  .object({
    jobId: z.uuid("发布任务标识无效。"),
    outcome: z.enum(["published", "unknown", "failed"]),
    externalPublicationRef: z.string().trim().max(240).optional(),
    failureCode: z.string().trim().max(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === "published" && !value.externalPublicationRef) {
      context.addIssue({
        code: "custom",
        path: ["externalPublicationRef"],
        message: "发布成功必须包含平台结果凭证。",
      });
    }
    if (value.outcome !== "published" && !value.failureCode) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "未知或失败结果必须包含失败代码。",
      });
    }
  });

export const contentReviewFormSchema = z
  .object({
    contentId: z.uuid("内容记录标识无效。"),
    reviewedVersion: z
      .string()
      .regex(/^[1-9]\d*$/, "审核版本无效，请刷新后重试。")
      .refine((value) => Number.isSafeInteger(Number(value)), "审核版本无效。"),
    approvalId: z.uuid("审核请求标识无效，请刷新后重试。"),
    decision: z.enum(["approved", "rejected"]),
    evidenceRef: privateReference,
    notes: z.string().trim().max(2_000, "审核备注不能超过 2000 个字符。"),
  })
  .superRefine((value, context) => {
    if (value.decision === "rejected" && !value.notes)
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "退回营销内容时必须填写原因。",
      });
  });

const videoText = z
  .string()
  .trim()
  .min(1, "此字段不能为空。")
  .max(2_000, "此字段不能超过 2000 个字符。");
const videoReference = z
  .string()
  .trim()
  .regex(/^(?:source|evidence|asset)-[a-z0-9][a-z0-9_-]{2,120}$/i, "请填写脱敏的私有来源引用。");

export const videoProjectFormSchema = z.object({
  productId: z.uuid("产品记录标识无效。"),
  objective: videoText,
  targetAudience: z
    .string()
    .trim()
    .min(1, "请填写目标受众。")
    .max(240, "目标受众不能超过 240 个字符。"),
  sourceFactRefs: z
    .array(privateReference)
    .min(1, "至少选择一条已核验产品事实。")
    .max(24, "最多选择 24 条产品事实。"),
  sourceAssetRefs: z.array(videoReference).max(16, "最多选择 16 个已授权素材。").default([]),
  platforms: z
    .array(z.enum(["facebook", "instagram", "x", "youtube", "tiktok"]))
    .min(1, "至少选择一个导出平台。")
    .max(5),
});

export const videoReviewFormSchema = z
  .object({
    videoId: z.uuid("视频记录标识无效。"),
    decision: z.enum(["approved", "rejected"]),
    evidenceRef: privateReference,
    notes: z.string().trim().max(2_000, "审核备注不能超过 2000 个字符。"),
  })
  .superRefine((value, context) => {
    if (value.decision === "rejected" && !value.notes)
      context.addIssue({ code: "custom", path: ["notes"], message: "退回视频时必须填写原因。" });
  });

const modelProvider = z.enum(["openai", "anthropic", "google", "openai-compatible"]);
const optionalProviderText = z.string().trim().max(2_000, "字段不能超过 2000 个字符。");

export const productAgentModelSettingsSchema = z
  .object({
    configId: z.string().trim().max(120, "模型配置标识无效。"),
    name: z.string().trim().min(1, "请填写配置名称。").max(120, "配置名称不能超过 120 个字符。"),
    isDefault: z.boolean(),
    provider: modelProvider,
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

const videoProvider = z.enum([
  "alibaba",
  "bytedance",
  "fal",
  "google",
  "google-vertex",
  "kling",
  "replicate",
  "xai",
]);

/** Shared by the browser form and its Server Action; credentials are write-only. */
export const videoProviderModelSettingsFormSchema = z
  .object({
    provider: videoProvider,
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
    provider: videoProvider,
    modelId: z.string().trim().min(1, "请选择已验证模型。").max(240),
    requiredCapabilities: z
      .array(
        z.enum([
          "text-to-video",
          "image-to-video",
          "reference-to-video",
          "video-editing",
          "audio-generation",
        ]),
      )
      .min(1),
    aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
    durationSeconds: z.coerce.number().int().positive().max(30),
    resolution: z
      .string()
      .trim()
      .regex(/^\d{3,5}x\d{3,5}$/),
    expectedCostCents: z.coerce.number().int().positive().max(100_000_000),
  })
  .strict();
