import { z } from "zod";

export const productStreamFields = [
  "product.product_name",
  "product.product_type",
  "product.internal_sku",
  "product.oe_numbers",
  "product.application",
  "product.vehicle_brand",
  "product.vehicle_model",
  "specifications.clutch_diameter_mm",
  "specifications.spline_count",
  "specifications.spline_size",
  "specifications.friction_material",
  "specifications.kit_contents",
  "specifications.gross_weight_kg",
  "specifications.net_weight_kg",
  "specifications.package_size",
  "commercial.moq",
  "commercial.estimated_lead_time_days",
  "commercial.packaging",
  "commercial.supported_customization",
  "commercial.sample_available",
] as const;

export const productStreamFieldSchema = z.enum(productStreamFields);
export const productStreamValueSchema = z
  .union([
    z.string().max(4000),
    z.number().finite(),
    z.boolean(),
    z.array(z.string().max(4000)).max(100),
  ])
  .nullable();

// Model output is a proposal. Complete elements still require source and domain validation.
export const productStreamProposalSchema = z.strictObject({
  field: productStreamFieldSchema,
  value: productStreamValueSchema,
  evidenceRef: z.string().max(500).nullable(),
});
export type ProductStreamProposal = z.infer<typeof productStreamProposalSchema>;

const envelope = {
  protocol: z.literal("product-agent.v1"),
  runId: z.uuid(),
  sequence: z.number().int().positive(),
};
export const productStreamEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...envelope,
    type: z.literal("stage"),
    stage: z.enum(["preparing", "generating", "completed", "failed", "interrupted"]),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("field"),
    field: productStreamFieldSchema,
    status: z.enum(["waiting", "source_validated", "needs_evidence", "invalid"]),
    value: productStreamValueSchema,
    evidenceRef: z.string().max(500).nullable(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("draft"),
    productId: z.uuid(),
    version: z.number().int().positive(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("error"),
    code: z.enum(["run_failed", "interrupted"]),
    message: z.string().max(500),
  }),
]);
export type ProductStreamEvent = z.infer<typeof productStreamEventSchema>;
