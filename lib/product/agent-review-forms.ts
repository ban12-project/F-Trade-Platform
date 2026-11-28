import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";
import { productImageFilesSchema } from "@/lib/product/source-image-contracts";

export const productReviewFormSchema = z
  .object({
    productId: z.uuid("产品记录标识无效。"),
    reviewedVersion: z
      .string()
      .regex(/^[1-9]\d*$/, "审核版本无效，请刷新后重试。")
      .refine((value) => Number.isSafeInteger(Number(value)), "审核版本无效。"),
    approvalId: z.uuid("审核请求标识无效，请刷新后重试。"),
    decision: z.enum(["approved", "rejected"]),
    imageConsistencyConfirmed: z.enum(["true", "false"]).optional(),
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
    imageFiles: productImageFilesSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.hasUpload) return;
    if (!value.sourceRef)
      context.addIssue({ code: "custom", path: ["sourceRef"], message: "请选择来源资料。" });
    if (!value.evidenceRef)
      context.addIssue({
        code: "custom",
        path: ["evidenceRef"],
        message: "请选择对应的来源文件。",
      });
    if (value.sourceText.trim().length < 20)
      context.addIssue({
        code: "custom",
        path: ["sourceText"],
        message: "请粘贴至少 20 个字符的已授权资料文本。",
      });
  });
