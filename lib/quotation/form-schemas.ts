import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";
import { quotationValidityDays, quotationValiditySchema } from "@/lib/quotation/validity";

const positiveMoney = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,4})?$/, "单价必须是正数，最多四位小数。")
  .refine((value) => Number(value) > 0, "单价必须大于 0。")
  .refine((value) => {
    if (!/^\d+(?:\.\d{1,4})?$/.test(value)) return true;
    const numeric = Number(value);
    const [integer, fraction = ""] = value.split(".");
    const significantFraction = fraction.replace(/0+$/, "");
    const canonical =
      integer.replace(/^0+(?=\d)/, "") + (significantFraction ? `.${significantFraction}` : "");
    // Compare the serialized decimal, not binary arithmetic: never silently round human prices.
    return Number.isSafeInteger(Math.trunc(numeric)) && String(numeric) === canonical;
  }, "单价超出可准确保存的范围，请核对金额；系统不会自动四舍五入。");

const positiveIntegerText = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, "必须填写正整数。")
  .refine((value) => Number.isSafeInteger(Number(value)), "数值超出可准确保存的整数范围，请核对。");

export const quotationDraftFormSchema = z
  .object({
    evidenceRef: privateReference,
    projectId: z.uuid("项目标识无效。"),
    quotationId: z.uuid("报价标识无效。").optional().or(z.literal("")),
    rfqId: z.uuid("请选择已确认完整的客户需求。"),
    productId: z.uuid("请选择已核实的产品。"),
    unitPrice: positiveMoney,
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "币种必须是三位大写 ISO 代码。"),
    moq: positiveIntegerText,
    leadTimeDays: z
      .string()
      .trim()
      .regex(/^\d+$/, "交期天数必须是非负整数。")
      .refine(
        (value) => Number.isSafeInteger(Number(value)),
        "交期超出可准确保存的整数范围，请核对。",
      ),
    paymentTerms: z.string().trim().min(1, "请填写付款条件。").max(500),
    validityDays: positiveIntegerText,
    validityStart: z.string().trim().optional(),
    validityEnd: z.string().trim().optional(),
    validityTimeZone: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (!value.validityStart && !value.validityEnd && !value.validityTimeZone) return;
    const result = quotationValiditySchema.safeParse({
      version: 1,
      starts_on: value.validityStart,
      expires_on: value.validityEnd,
      time_zone: value.validityTimeZone,
    });
    if (!result.success) {
      const fields: Record<string, string> = {
        starts_on: "validityStart",
        expires_on: "validityEnd",
        time_zone: "validityTimeZone",
      };
      for (const issue of result.error.issues)
        context.addIssue({
          code: "custom",
          path: [fields[String(issue.path[0])] ?? "validityStart"],
          message: issue.message,
        });
    } else if (quotationValidityDays(result.data) !== Number(value.validityDays)) {
      context.addIssue({
        code: "custom",
        path: ["validityDays"],
        message: "有效天数须与起止日期一致，包含首尾日期。",
      });
    }
  });

export const quotationDecisionFormSchema = z
  .object({
    projectId: z.uuid("项目标识无效。"),
    quotationId: z.uuid("报价标识无效。"),
    reviewedVersion: z
      .string()
      .regex(/^[1-9]\d*$/, "审核版本无效，请刷新后重试。")
      .refine((value) => Number.isSafeInteger(Number(value)), "审核版本无效。"),
    approvalId: z.uuid("审核请求标识无效，请刷新后重试。"),
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
  channelRef: z
    .string()
    .trim()
    .min(1, "请填写发送渠道。")
    .max(240, "发送渠道不能超过 240 个字符。"),
  externalRef: z
    .string()
    .trim()
    .min(1, "请填写外部发送凭证。")
    .max(240, "发送凭证不能超过 240 个字符，请核对消息编号或回执链接。"),
});
