type ProductSection = Record<string, unknown>;

export interface ProductBlockingDraft {
  evidence_refs: string[];
  field_evidence: Record<string, string>;
  product: ProductSection;
  specifications?: ProductSection;
  commercial?: ProductSection;
}

const corePaths = ["product.product_name", "product.product_type", "product.internal_sku"] as const;

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function valueAt(draft: ProductBlockingDraft, path: string) {
  const [section, field] = path.split(".");
  return (
    draft[section as "product" | "specifications" | "commercial"] as ProductSection | undefined
  )?.[field];
}

function presentFactPaths(draft: ProductBlockingDraft) {
  return (["product", "specifications", "commercial"] as const).flatMap((section) =>
    Object.entries(draft[section] ?? {})
      .filter(([, value]) => hasValue(value))
      .map(([field]) => `${section}.${field}`),
  );
}

function hasApplicationIdentity(draft: ProductBlockingDraft) {
  return ["product.application", "product.vehicle_brand", "product.vehicle_model"].every((path) =>
    hasValue(valueAt(draft, path)),
  );
}

function hasOeIdentity(draft: ProductBlockingDraft) {
  const oeNumbers = valueAt(draft, "product.oe_numbers");
  return Array.isArray(oeNumbers) && oeNumbers.length > 0;
}

/** Compute missing required product facts and field evidence for draft review or approval. */
export function productBlockingFields(
  draft: ProductBlockingDraft,
  allowVerifiedApplication: boolean,
): string[] {
  const blocking: string[] = corePaths.filter((path) => !hasValue(valueAt(draft, path)));
  if (!hasOeIdentity(draft) && !(allowVerifiedApplication && hasApplicationIdentity(draft))) {
    blocking.push("oe_numbers_or_verified_application");
  }

  for (const path of presentFactPaths(draft)) {
    const evidenceRef = draft.field_evidence[path];
    if (!evidenceRef || !draft.evidence_refs.includes(evidenceRef)) {
      blocking.push(`field_evidence.${path}`);
    }
  }
  return [...new Set<string>(blocking)].sort();
}

/** Return only hard blockers that cannot be satisfied by human verification of complete fitment. */
export function productApprovalBlockingFields(draft: ProductBlockingDraft): string[] {
  return productBlockingFields(draft, true);
}
