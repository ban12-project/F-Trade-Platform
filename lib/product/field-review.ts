import type { ProductEvidencePreview } from "./evidence-preview";

export type ProductReviewFact = { path: string; value: string; evidence: string };

export function productReviewValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(productReviewValue).filter(Boolean).join(", ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

// Narrow only server-authorized previews. Neither a matching label nor source ID
// alone is enough to associate an excerpt with the currently saved field.
export function productFieldSources(
  sources: ProductEvidencePreview[],
  fact: ProductReviewFact,
): ProductEvidencePreview[] {
  if (!fact.evidence) return [];
  return sources.flatMap((source) => {
    const fields = source.fields.filter(
      (field) => field.path === fact.path && field.reference === fact.evidence,
    );
    return fields.length ? [{ ...source, fields }] : [];
  });
}
