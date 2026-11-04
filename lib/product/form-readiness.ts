import {
  manualProductFactEvidenceFields,
  type ProductCatalogForm,
  productCatalogFormSchema,
} from "./catalog-form-schema";
import { isProductEvidenceLocationRef } from "./retained-evidence";

export const productFormFactStatusLabels = {
  missing: "待填写",
  invalid: "请检查填写格式",
  unlinked: "待选择来源",
  unavailable: "来源当前不可选，请核对访问权限",
  retained: "保留原来源，待确认访问",
  linked: "已关联资料，待人工核实",
} as const;

/** Preparation feedback only. This cannot authorize a source or make a product Ready. */
export function productFormReadiness(
  values: Partial<ProductCatalogForm>,
  availableEvidenceIds: readonly string[],
  originalValues: Partial<ProductCatalogForm> = {},
) {
  const available = new Set(availableEvidenceIds);
  const facts = manualProductFactEvidenceFields
    .filter(([name]) => name !== "kitContents" || values.productType === "clutch_kit")
    .map(([name, evidenceName, label]) => {
      const value = values[name]?.trim() ?? "";
      const reference = values[evidenceName]?.trim() ?? "";
      const present =
        name === "oeNumbers"
          ? value.split(/[\n,;，；]/).some((part) => part.trim())
          : Boolean(value);
      const retained =
        isProductEvidenceLocationRef(reference) &&
        reference === originalValues[evidenceName] &&
        values[name] === originalValues[name] &&
        values.sourceRef === originalValues.sourceRef;
      const status: keyof typeof productFormFactStatusLabels = !present
        ? "missing"
        : !productCatalogFormSchema.shape[name].safeParse(values[name]).success
          ? "invalid"
          : !reference
            ? "unlinked"
            : available.has(reference)
              ? "linked"
              : retained
                ? "retained"
                : "unavailable";
      return { name, label, present, reference, status };
    });
  const core = facts.slice(0, 3);
  const oe = facts.find((fact) => fact.name === "oeNumbers");
  const application = facts.filter((fact) =>
    ["application", "vehicleBrand", "vehicleModel"].includes(fact.name),
  );
  const identity =
    oe?.status === "linked"
      ? "OE 资料已关联，仍需人工核实"
      : application.every((fact) => fact.status === "linked")
        ? "完整适配资料已关联，须由人工核实适配关系"
        : "待补充有来源的 OE 编号，或适配说明、车辆品牌和车型（须人工核实）";
  const sourceRef = values.sourceRef?.trim() ?? "";
  const sourceStatus = !sourceRef
    ? "待选择主要来源资料"
    : available.has(sourceRef)
      ? "已选择主要来源资料"
      : sourceRef === originalValues.sourceRef
        ? "保留原主要来源，待确认访问"
        : "主要来源当前不可选，请重新选择";
  return {
    facts,
    core,
    identity,
    sourceStatus,
    filled: facts.filter((fact) => fact.present).length,
    linked: facts.filter((fact) => fact.status === "linked").length,
    retained: facts.filter((fact) => fact.status === "retained").length,
    needsAttention: facts.filter(
      (fact) => fact.present && !["linked", "retained"].includes(fact.status),
    ),
    orphaned: facts.filter((fact) => !fact.present && fact.reference),
  };
}
