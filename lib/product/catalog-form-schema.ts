import { z } from "zod";

const sourceReference = z
  .string()
  .trim()
  .regex(/^(?:source|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i, "请填写脱敏的私有来源引用。");
const evidenceReference = z
  .string()
  .trim()
  .regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "请填写脱敏的私有证据引用。");
const optionalEvidenceReference = z.union([evidenceReference, z.literal("")]);
const optionalCatalogText = z.string().trim().max(240, "字段不能超过 240 个字符。");
const optionalPositiveDecimal = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^$|^\d+(?:\.\d+)?$/, `${label}必须是正数。`)
    .refine((value) => value === "" || Number(value) > 0, `${label}必须大于 0。`);
const optionalPositiveInteger = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^$|^[1-9]\d*$/, `${label}必须是正整数。`);
const optionalNonNegativeInteger = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^$|^(?:0|[1-9]\d*)$/, `${label}必须是非负整数。`);

export const kitContentValues = ["clutch_disc", "pressure_plate", "release_bearing"] as const;

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
  ["kitContents", "kitContentsEvidenceRef", "套件组成"],
  ["grossWeightKg", "grossWeightKgEvidenceRef", "毛重"],
  ["netWeightKg", "netWeightKgEvidenceRef", "净重"],
  ["packageSize", "packageSizeEvidenceRef", "包装尺寸"],
  ["moq", "moqEvidenceRef", "最小起订量"],
  ["estimatedLeadTimeDays", "estimatedLeadTimeDaysEvidenceRef", "预计交期"],
  ["packaging", "packagingEvidenceRef", "包装方式"],
  ["supportedCustomization", "supportedCustomizationEvidenceRef", "支持定制"],
  ["sampleAvailable", "sampleAvailableEvidenceRef", "样品可用性"],
] as const;

export const productCatalogFormSchema = z
  .object({
    productName: z
      .string()
      .trim()
      .min(1, "请填写产品名称。")
      .max(160, "产品名称不能超过 160 个字符。"),
    productNameEvidenceRef: evidenceReference,
    productType: z.enum(["clutch_disc", "clutch_cover", "release_bearing", "clutch_kit"]),
    productTypeEvidenceRef: evidenceReference,
    internalSku: z
      .string()
      .trim()
      .min(1, "请填写内部编号。")
      .max(120, "内部编号不能超过 120 个字符。"),
    internalSkuEvidenceRef: evidenceReference,
    oeNumbers: optionalCatalogText,
    oeNumbersEvidenceRef: optionalEvidenceReference,
    application: optionalCatalogText,
    applicationEvidenceRef: optionalEvidenceReference,
    vehicleBrand: optionalCatalogText,
    vehicleBrandEvidenceRef: optionalEvidenceReference,
    vehicleModel: optionalCatalogText,
    vehicleModelEvidenceRef: optionalEvidenceReference,
    clutchDiameterMm: optionalPositiveDecimal("盘径"),
    clutchDiameterMmEvidenceRef: optionalEvidenceReference,
    splineCount: optionalPositiveInteger("花键数"),
    splineCountEvidenceRef: optionalEvidenceReference,
    splineSize: optionalCatalogText,
    splineSizeEvidenceRef: optionalEvidenceReference,
    frictionMaterial: optionalCatalogText,
    frictionMaterialEvidenceRef: optionalEvidenceReference,
    kitContents: optionalCatalogText,
    kitContentsEvidenceRef: optionalEvidenceReference,
    grossWeightKg: optionalPositiveDecimal("毛重"),
    grossWeightKgEvidenceRef: optionalEvidenceReference,
    netWeightKg: optionalPositiveDecimal("净重"),
    netWeightKgEvidenceRef: optionalEvidenceReference,
    packageSize: optionalCatalogText,
    packageSizeEvidenceRef: optionalEvidenceReference,
    moq: optionalPositiveInteger("最小起订量"),
    moqEvidenceRef: optionalEvidenceReference,
    estimatedLeadTimeDays: optionalNonNegativeInteger("预计交期"),
    estimatedLeadTimeDaysEvidenceRef: optionalEvidenceReference,
    packaging: optionalCatalogText,
    packagingEvidenceRef: optionalEvidenceReference,
    supportedCustomization: optionalCatalogText,
    supportedCustomizationEvidenceRef: optionalEvidenceReference,
    sampleAvailable: z.enum(["", "yes", "no"]),
    sampleAvailableEvidenceRef: optionalEvidenceReference,
    sourceRef: sourceReference,
  })
  .superRefine((value, context) => {
    for (const [valueKey, evidenceKey, label] of manualProductFactEvidenceFields.slice(3)) {
      const fact = value[valueKey];
      const evidence = value[evidenceKey];
      const hasFact =
        typeof fact === "string" ? fact.trim().length > 0 : fact !== undefined && fact !== null;
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

    const kitContents = value.kitContents
      .split(/[\s,;，；]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const invalidKitContent = kitContents.find(
      (item) => !kitContentValues.includes(item as (typeof kitContentValues)[number]),
    );
    if (invalidKitContent) {
      context.addIssue({
        code: "custom",
        path: ["kitContents"],
        message: `套件组成包含不支持的值：${invalidKitContent}。`,
      });
    }
    if (kitContents.length && value.productType !== "clutch_kit") {
      context.addIssue({
        code: "custom",
        path: ["kitContents"],
        message: "只有离合器套件可以填写套件组成。",
      });
    }

    if (
      value.grossWeightKg &&
      value.netWeightKg &&
      Number(value.netWeightKg) > Number(value.grossWeightKg)
    ) {
      context.addIssue({ code: "custom", path: ["netWeightKg"], message: "净重不能大于毛重。" });
    }
  });

export type ProductCatalogForm = z.infer<typeof productCatalogFormSchema>;
