import { z } from "zod";

const sourceReference = z.string().trim().regex(
  /^(?:source|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i,
  "请填写脱敏的私有来源引用。",
);
const evidenceReference = z.string().trim().regex(
  /^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i,
  "请填写脱敏的私有证据引用。",
);
const optionalEvidenceReference = z.union([evidenceReference, z.literal("")]);
const optionalCatalogText = z.string().trim().max(240, "字段不能超过 240 个字符。");

export const manualProductFactEvidenceFields = [
  ["productName", "productNameEvidenceRef", "产品名称"],
  ["productType", "productTypeEvidenceRef", "产品类型"],
  ["internalSku", "internalSkuEvidenceRef", "内部编号"],
  ["oeNumbers", "oeNumbersEvidenceRef", "OE / OEM 编号"],
  ["application", "applicationEvidenceRef", "适配说明"],
  ["vehicleBrand", "vehicleBrandEvidenceRef", "车辆品牌"],
  ["vehicleModel", "vehicleModelEvidenceRef", "车型"],
  ["clutchDiameterMm", "clutchDiameterMmEvidenceRef", "盘径"],
  ["splineCount", "splineCountEvidenceRef", "花键数"],
  ["splineSize", "splineSizeEvidenceRef", "花键尺寸"],
  ["frictionMaterial", "frictionMaterialEvidenceRef", "摩擦材料"],
] as const;

export const productCatalogFormSchema = z.object({
  productName: z.string().trim().min(1, "请填写产品名称。").max(160, "产品名称不能超过 160 个字符。"),
  productNameEvidenceRef: evidenceReference,
  productType: z.enum(["clutch_disc", "clutch_cover", "release_bearing", "clutch_kit"]),
  productTypeEvidenceRef: evidenceReference,
  internalSku: z.string().trim().min(1, "请填写内部编号。").max(120, "内部编号不能超过 120 个字符。"),
  internalSkuEvidenceRef: evidenceReference,
  oeNumbers: optionalCatalogText,
  oeNumbersEvidenceRef: optionalEvidenceReference,
  application: optionalCatalogText,
  applicationEvidenceRef: optionalEvidenceReference,
  vehicleBrand: optionalCatalogText,
  vehicleBrandEvidenceRef: optionalEvidenceReference,
  vehicleModel: optionalCatalogText,
  vehicleModelEvidenceRef: optionalEvidenceReference,
  clutchDiameterMm: z.string().trim().regex(/^$|^\d+(?:\.\d+)?$/, "盘径必须是正数。")
    .refine((value) => value === "" || Number(value) > 0, "盘径必须大于 0。"),
  clutchDiameterMmEvidenceRef: optionalEvidenceReference,
  splineCount: z.string().trim().regex(/^$|^[1-9]\d*$/, "花键数必须是正整数。"),
  splineCountEvidenceRef: optionalEvidenceReference,
  splineSize: optionalCatalogText,
  splineSizeEvidenceRef: optionalEvidenceReference,
  frictionMaterial: optionalCatalogText,
  frictionMaterialEvidenceRef: optionalEvidenceReference,
  sourceRef: sourceReference,
}).superRefine((value, context) => {
  for (const [valueKey, evidenceKey, label] of manualProductFactEvidenceFields.slice(3)) {
    const fact = value[valueKey];
    const evidence = value[evidenceKey];
    const hasFact = typeof fact === "string" ? fact.trim().length > 0 : fact !== undefined && fact !== null;
    const hasEvidence = typeof evidence === "string" && evidence.trim().length > 0;
    if (hasFact && !hasEvidence) {
      context.addIssue({
        code: "custom",
        path: [evidenceKey],
        message: `${label}已填写，必须单独绑定证据引用。`,
      });
    }
    if (!hasFact && hasEvidence) {
      context.addIssue({
        code: "custom",
        path: [evidenceKey],
        message: `${label}未填写，不能单独保留证据引用。`,
      });
    }
  }
});

export type ProductCatalogForm = z.infer<typeof productCatalogFormSchema>;
