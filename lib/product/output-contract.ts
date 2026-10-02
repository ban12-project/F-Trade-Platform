import type { jsonSchema } from "ai";
import contract from "../../contracts/data/product-draft.schema.json";

// Provider wire schemas use a conservative JSON Schema subset. Business constraints
// (bounds, uniqueness, evidence support) remain enforced by the unchanged AJV contract.
function wireSchema(value: Record<string, unknown>): Record<string, unknown> {
  if (value.type === "object") {
    const properties = Object.fromEntries(
      Object.entries(value.properties as Record<string, Record<string, unknown>>).map(
        ([key, schema]) => [key, wireSchema(schema)],
      ),
    );
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (value.type === "array")
    return { type: "array", items: wireSchema(value.items as Record<string, unknown>) };
  if (value.enum) return { type: "string", enum: value.enum };
  return { type: value.type };
}
const sections = ["product", "specifications", "commercial"] as const;
const nullable = (value: Record<string, unknown>) => ({ anyOf: [value, { type: "null" }] });
const properties: Record<string, unknown> = {};
for (const [key, schema] of Object.entries(contract.properties)) {
  if (key === "field_evidence") continue;
  properties[key] = wireSchema(schema);
}
const evidence: Record<string, unknown> = {};
for (const section of sections) {
  const fields = contract.properties[section].properties;
  const values = Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => {
      evidence[`${section}.${key}`] = nullable({ type: "string" });
      return [key, nullable(wireSchema(schema))];
    }),
  );
  properties[section] = {
    type: "object",
    properties: values,
    required: Object.keys(values),
    additionalProperties: false,
  };
}
properties.verification_status = { type: "string", enum: ["review_required"] };
properties.field_evidence = {
  type: "object",
  properties: evidence,
  required: Object.keys(evidence),
  additionalProperties: false,
};
export const PRODUCT_OUTPUT_SCHEMA = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
} as Parameters<typeof jsonSchema>[0];
export const PRODUCT_OUTPUT_TYPE_INSTRUCTIONS = `Output representation: follow this schema. Null means unsupported/unknown and will be removed before business validation. Never fill a missing fact merely to satisfy the schema. Field evidence for a null fact must be null. Explicit quantities must be encoded as JSON numbers in the field's named unit, not strings with units; do not estimate or convert ambiguous units. MOQ is an integer count; Sample available yes/no maps to true/false. oe_numbers and kit_contents are arrays. These representation conversions are allowed; inferring engineering facts is not.\n${JSON.stringify(PRODUCT_OUTPUT_SCHEMA)}`;
