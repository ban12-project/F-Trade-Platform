import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";

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
    else if (value.decision === "confirmed" && !Number.isSafeInteger(Number(value.leadTimeDays)))
      context.addIssue({
        code: "custom",
        path: ["leadTimeDays"],
        message: "交期超出可准确保存的整数范围，请核对。",
      });
    if (value.decision === "rejected" && !value.notes)
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "拒绝交期确认时必须填写原因。",
      });
  });
