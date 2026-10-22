/** Customer requests, not verified product facts or factory commitments. */
export const rfqCustomerRequirements = [
  { field: "vehicleYear", section: "product", key: "vehicle_year", label: "车型年份" },
  { field: "engine", section: "product", key: "engine", label: "发动机" },
  {
    field: "requiredSpecification",
    section: "product",
    key: "required_specification",
    label: "规格要求",
  },
  {
    field: "packagingRequirement",
    section: "commercial",
    key: "packaging_requirement",
    label: "包装要求",
  },
  {
    field: "expectedDelivery",
    section: "commercial",
    key: "expected_delivery",
    label: "客户期望交付",
  },
  { field: "customization", section: "commercial", key: "customization", label: "定制要求" },
] as const;
type RequirementField = (typeof rfqCustomerRequirements)[number]["field"];

function storedText(payload: unknown, section: string, key: string) {
  if (!payload || typeof payload !== "object") return "";
  const group = (payload as Record<string, unknown>)[section];
  if (!group || typeof group !== "object") return "";
  const value = (group as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function readRfqCustomerRequirements(payload: unknown) {
  return Object.fromEntries(
    rfqCustomerRequirements.map(({ field, section, key }) => [
      field,
      storedText(payload, section, key),
    ]),
  ) as Record<RequirementField, string>;
}

/** Omission by an older client preserves existing requests; an explicit empty value clears them. */
export function writeRfqCustomerRequirements(
  input: Partial<Record<RequirementField, string>>,
  previous?: unknown,
) {
  const result: { product: Record<string, string>; commercial: Record<string, string> } = {
    product: {},
    commercial: {},
  };
  for (const { field, section, key } of rfqCustomerRequirements) {
    const value = input[field] ?? storedText(previous, section, key);
    if (value) result[section][key] = value;
  }
  return result;
}
