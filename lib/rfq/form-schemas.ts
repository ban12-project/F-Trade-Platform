import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";

const optionalRfqText = z.string().trim().max(240, "字段不能超过 240 个字符。");

export const rfqReadyFormSchema = z.object({
  projectId: z.uuid("项目标识无效。").optional().or(z.literal("")),
  rfqId: z.uuid("询盘标识无效。"),
  evidenceRef: z
    .string()
    .trim()
    .regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "请填写有效的需求确认凭据。"),
});

export const rfqFormSchema = z.object({
  leadId: z.uuid("入站线索标识无效。").optional().or(z.literal("")),
  customerName: optionalRfqText,
  customerCompany: optionalRfqText,
  customerCountry: optionalRfqText,
  productType: z
    .enum(["clutch_disc", "clutch_cover", "release_bearing", "clutch_kit", ""])
    .refine((value) => value !== "", "请确认客户需要的产品类型。"),
  oeNumber: optionalRfqText,
  vehicleBrand: optionalRfqText,
  vehicleModel: optionalRfqText,
  vehicleYear: optionalRfqText.optional(),
  engine: optionalRfqText.optional(),
  requiredSpecification: optionalRfqText.optional(),
  packagingRequirement: optionalRfqText.optional(),
  expectedDelivery: optionalRfqText.optional(),
  customization: optionalRfqText.optional(),
  quantity: z
    .string()
    .trim()
    .regex(/^$|^[1-9]\d*$/, "数量必须是正整数。")
    .refine(
      (value) => value === "" || Number.isSafeInteger(Number(value)),
      "数量超出可准确保存的整数范围，请核对。",
    ),
  destination: optionalRfqText,
  evidenceRef: privateReference,
});

export const inquirySuggestionRequestSchema = z
  .object({
    projectId: z.uuid("项目标识无效。"),
    leadId: z.uuid("入站线索标识无效。"),
  })
  .strict();

export const inquirySuggestionFieldsSchema = rfqFormSchema
  .pick({
    productType: true,
    oeNumber: true,
    vehicleBrand: true,
    vehicleModel: true,
    quantity: true,
    destination: true,
  })
  .partial()
  .strict();
