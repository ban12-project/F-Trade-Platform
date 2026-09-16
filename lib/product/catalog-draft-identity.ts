import { finalizeProductAgentDraft } from "./agent";
import type { ProductAgentEvidenceLocatedSource } from "./evidence-locations";
import type { ProductDraft } from "./verification";

/** Preserve a selected record's literal, labelled identifier, never infer another product fact. */
export function preserveCatalogDraftIdentity(
  draft: ProductDraft,
  source: ProductAgentEvidenceLocatedSource,
  identifier: string,
) {
  if (draft.product.internal_sku !== undefined) return { draft, preserved: false };
  for (const location of source.evidence_locations) {
    try {
      finalizeProductAgentDraft(
        {
          record_id: source.record_id,
          source_ref: source.source_ref,
          evidence_refs: [location.ref],
          field_evidence: { "product.internal_sku": location.ref },
          product: { internal_sku: identifier },
          verification_status: "review_required",
          blocking_missing_fields: [],
          optional_missing_fields: [],
        },
        { ...source, source_text: location.text, evidence_refs: [location.ref] },
      );
      return {
        preserved: true,
        draft: {
          ...draft,
          product: { ...draft.product, internal_sku: identifier },
          field_evidence: { ...draft.field_evidence, "product.internal_sku": location.ref },
        },
      };
    } catch {
      // Another excerpt may contain the explicit identifier; no matching excerpt means rejection.
    }
  }
  throw new Error("Product Agent selected catalog identifier has no matching labelled evidence");
}
