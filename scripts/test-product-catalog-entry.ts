import { productCatalogFormSchema } from "../lib/form-schemas";
import { buildProductCatalogDraft } from "../lib/products";

const validInput = productCatalogFormSchema.parse({
  productName: "Synthetic clutch disc",
  productType: "clutch_disc",
  internalSku: "SYN-DISC-001",
  oeNumbers: "",
  application: "",
  vehicleBrand: "",
  vehicleModel: "",
  clutchDiameterMm: "240",
  splineCount: "21",
  splineSize: "20 x 18",
  frictionMaterial: "Synthetic material",
  sourceRef: "source-catalog-001",
  evidenceRef: "evidence-product-001",
});

const draft = buildProductCatalogDraft(validInput, "synthetic-product-001");
if (draft.verification_status !== "review_required") {
  throw new Error("Catalog entry must create a review-required draft");
}
if (!draft.blocking_missing_fields.includes("oe_numbers_or_verified_application")) {
  throw new Error("A draft without OE or complete application identity must remain blocked");
}
for (const field of [
  "product.product_name",
  "product.product_type",
  "product.internal_sku",
  "specifications.clutch_diameter_mm",
  "specifications.spline_count",
] as const) {
  if (draft.field_evidence[field] !== "evidence-product-001") {
    throw new Error(`Catalog draft must attach evidence to ${field}`);
  }
}
if (productCatalogFormSchema.safeParse({ ...validInput, sourceRef: "/private/tmp/catalog.pdf" }).success) {
  throw new Error("Catalog entry must reject local file paths as source references");
}
if (productCatalogFormSchema.safeParse({ ...validInput, clutchDiameterMm: "0" }).success) {
  throw new Error("Catalog entry must reject a zero clutch diameter");
}

console.log("PASS product catalog entry");
