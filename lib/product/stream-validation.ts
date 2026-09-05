import { finalizeProductAgentDraft, type ProductAgentSource } from "./agent";
import {
  assertProductAgentEvidenceLocations,
  compactProductAgentEvidenceRefs,
  type ProductAgentEvidenceLocatedSource,
} from "./evidence-locations";
import { productStreamProposalSchema } from "./stream-contract";
import type { ProductDraft } from "./verification";

type LocatedSource = ProductAgentSource & ProductAgentEvidenceLocatedSource;

export function emptyProductStreamDraft(source: LocatedSource): ProductDraft {
  return finalizeProductAgentDraft(
    {
      record_id: source.record_id,
      source_ref: source.source_ref,
      evidence_refs: source.evidence_refs,
      field_evidence: {},
      product: {},
      verification_status: "review_required",
      blocking_missing_fields: [],
      optional_missing_fields: [],
    },
    source,
  );
}

/** Append only: a later model element cannot silently replace a previously reviewed fact. */
export function validateProductStreamProposal(
  current: ProductDraft,
  value: unknown,
  source: LocatedSource,
) {
  const proposal = productStreamProposalSchema.parse(value);
  if (proposal.value === null || !proposal.evidenceRef)
    return { status: "needs_evidence" as const, proposal };
  if (Object.hasOwn(current.field_evidence, proposal.field))
    return { status: "invalid" as const, proposal };
  const [section, key] = proposal.field.split(".") as [
    "product" | "specifications" | "commercial",
    string,
  ];
  try {
    const candidate = finalizeProductAgentDraft(
      {
        ...current,
        // Full allowlist for validation; persisted evidence contains only used locations.
        evidence_refs: source.evidence_refs,
        [section]: { ...current[section], [key]: proposal.value },
        field_evidence: { ...current.field_evidence, [proposal.field]: proposal.evidenceRef },
      },
      source,
    );
    assertProductAgentEvidenceLocations(candidate, source, finalizeProductAgentDraft);
    return {
      status: "source_validated" as const,
      proposal,
      draft: compactProductAgentEvidenceRefs(candidate),
    };
  } catch {
    return { status: "invalid" as const, proposal };
  }
}
