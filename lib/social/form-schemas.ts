import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";

export const inboundContextRequestSchema = z.object({
  conversationId: z.string().trim().min(1, "入站会话标识无效。").max(160),
});

export const inboundRoutingFormSchema = z
  .object({
    conversationId: z.string().trim().min(1, "入站会话标识无效。").max(160),
    mode: z.enum(["create", "link"]),
    confirmed: z.literal("yes", { error: "请核对上下文和目标后确认分流。" }),
    reviewedMessageAt: z.iso.datetime({ error: "请先查看入站上下文。" }),
    reviewedContextDigest: z.string().regex(/^[a-f0-9]{64}$/, "请重新查看入站上下文。"),
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
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/, "请刷新页面并重新核对发布预览。"),
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
