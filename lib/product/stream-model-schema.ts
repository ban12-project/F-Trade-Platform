import { z } from "zod";
import type { productStreamFields } from "./stream-contract";

const text = z.string().min(1).max(4000);
const positiveNumber = z.number().finite().positive();
const positiveInteger = z.number().int().positive();

// Field-specific model guidance does not replace the independent source/domain validator.
const fieldValues = {
  "product.product_name": text,
  "product.product_type": z.enum(["clutch_disc", "clutch_cover", "release_bearing", "clutch_kit"]),
  "product.internal_sku": text,
  "product.oe_numbers": z.array(text).min(1).max(100),
  "product.application": text,
  "product.vehicle_brand": text,
  "product.vehicle_model": text,
  "specifications.clutch_diameter_mm": positiveNumber,
  "specifications.spline_count": positiveInteger,
  "specifications.spline_size": text,
  "specifications.friction_material": text,
  "specifications.kit_contents": z
    .array(z.enum(["clutch_disc", "pressure_plate", "release_bearing"]))
    .min(1)
    .max(3),
  "specifications.gross_weight_kg": positiveNumber,
  "specifications.net_weight_kg": positiveNumber,
  "specifications.package_size": text,
  "commercial.moq": positiveInteger,
  "commercial.estimated_lead_time_days": z.number().int().nonnegative(),
  "commercial.packaging": text,
  "commercial.supported_customization": text,
  "commercial.sample_available": z.boolean(),
} satisfies Record<(typeof productStreamFields)[number], z.ZodType>;

function proposal<Field extends keyof typeof fieldValues>(field: Field) {
  return z.strictObject({
    field: z.literal(field),
    value: fieldValues[field].nullable(),
    evidenceRef: z.string().min(1).max(500).nullable(),
  });
}

// The provider supports anyOf, but rejects oneOf emitted by Zod discriminatedUnion.
// Distinct literal field values still make the variants unambiguous.
export const productStreamModelProposalSchema = z.union([
  proposal("product.product_name"),
  proposal("product.product_type"),
  proposal("product.internal_sku"),
  proposal("product.oe_numbers"),
  proposal("product.application"),
  proposal("product.vehicle_brand"),
  proposal("product.vehicle_model"),
  proposal("specifications.clutch_diameter_mm"),
  proposal("specifications.spline_count"),
  proposal("specifications.spline_size"),
  proposal("specifications.friction_material"),
  proposal("specifications.kit_contents"),
  proposal("specifications.gross_weight_kg"),
  proposal("specifications.net_weight_kg"),
  proposal("specifications.package_size"),
  proposal("commercial.moq"),
  proposal("commercial.estimated_lead_time_days"),
  proposal("commercial.packaging"),
  proposal("commercial.supported_customization"),
  proposal("commercial.sample_available"),
]);
