/** Reviewed fitment labels. Generic Model/Make and component labels are not aliases. */
export const PRODUCT_FITMENT_LABELS = {
  "product.application": ["Application"],
  "product.vehicle_brand": ["Vehicle brand"],
  "product.vehicle_model": ["Vehicle model", "Fit Model"],
} satisfies Record<string, string[]>;

export function isFitmentField(field: string): boolean {
  return Object.hasOwn(PRODUCT_FITMENT_LABELS, field);
}

const fitmentLabelPattern = new RegExp(
  `\\b(?:${Object.values(PRODUCT_FITMENT_LABELS)
    .flat()
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"))
    .join("|")})\\b`,
  "i",
);

export function containsFitmentLabel(text: string): boolean {
  return fitmentLabelPattern.test(text);
}

export const PRODUCT_FITMENT_LABEL_INSTRUCTIONS = Object.entries(PRODUCT_FITMENT_LABELS)
  .map(
    ([field, labels]) => `${field}: ${labels.map((label) => JSON.stringify(label)).join(" or ")}`,
  )
  .join("\n");
