export const productFactLabels: Record<string, string> = {
  "product.product_name": "产品名称",
  "product.product_type": "产品类型",
  "product.internal_sku": "产品编号",
  "product.oe_numbers": "OE 编号",
  "product.application": "适用范围",
  "product.vehicle_brand": "车辆品牌",
  "product.vehicle_model": "车型",
  "specifications.clutch_diameter_mm": "离合器直径",
  "specifications.spline_count": "花键齿数",
  "specifications.spline_size": "花键尺寸",
  "specifications.friction_material": "摩擦材料",
  "specifications.kit_contents": "套件内容",
  "specifications.gross_weight_kg": "毛重",
  "specifications.net_weight_kg": "净重",
  "specifications.package_size": "包装尺寸",
  "commercial.moq": "起订量",
  "commercial.estimated_lead_time_days": "资料中的预计交期",
  "commercial.packaging": "包装",
  "commercial.supported_customization": "支持定制",
  "commercial.sample_available": "样品可用性",
};

export function productBlockerLabel(field: string) {
  if (field === "oe_numbers_or_verified_application")
    return "补充 OE 编号，或由人工核实完整的适配信息";
  if (field.startsWith("field_evidence."))
    return `${productFactLabels[field.slice(15)] ?? field.slice(15)}缺少证据`;
  return `${productFactLabels[field] ?? field}待补充`;
}
