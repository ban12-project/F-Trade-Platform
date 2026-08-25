import { z } from "zod";

export const emailSchema = z.string().trim().min(1, "请输入邮箱地址。").email("请输入有效的邮箱地址。");

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
  .regex(/^(?:source|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i, "请填写脱敏的私有引用，例如 evidence-product-001。");

const optionalCatalogText = z.string().trim().max(240, "字段不能超过 240 个字符。");

export const productCatalogFormSchema = z.object({
  productName: z.string().trim().min(1, "请填写产品名称。").max(160, "产品名称不能超过 160 个字符。"),
  productType: z.enum(["clutch_disc", "clutch_cover", "release_bearing", "clutch_kit"]),
  internalSku: z.string().trim().min(1, "请填写内部编号。").max(120, "内部编号不能超过 120 个字符。"),
  oeNumbers: optionalCatalogText,
  application: optionalCatalogText,
  vehicleBrand: optionalCatalogText,
  vehicleModel: optionalCatalogText,
  clutchDiameterMm: z
    .string()
    .trim()
    .regex(/^$|^\d+(?:\.\d+)?$/, "盘径必须是正数。")
    .refine((value) => value === "" || Number(value) > 0, "盘径必须大于 0。"),
  splineCount: z.string().trim().regex(/^$|^[1-9]\d*$/, "花键数必须是正整数。"),
  splineSize: optionalCatalogText,
  frictionMaterial: optionalCatalogText,
  sourceRef: privateReference,
  evidenceRef: privateReference,
});
