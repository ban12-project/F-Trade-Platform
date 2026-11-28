import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";

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
