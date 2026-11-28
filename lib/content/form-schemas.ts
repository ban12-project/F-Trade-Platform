import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";

const contentText = z
  .string()
  .trim()
  .min(1, "此字段不能为空。")
  .max(4_000, "此字段不能超过 4000 个字符。");

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

export const contentAgentRequestSchema = contentDraftFormSchema
  .pick({
    productId: true,
    contentType: true,
    factPath: true,
    objective: true,
    targetCustomer: true,
  })
  .extend({ projectId: z.uuid("项目标识无效。") });

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
