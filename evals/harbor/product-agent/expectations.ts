import { createHash } from "node:crypto";
import productDraftSchema from "../../../contracts/data/product-draft.schema.json";

import { finalizeProductAgentDraft } from "../../../lib/product/agent";
import { prepareProductAgentEvidenceSource } from "../../../lib/product/evidence-locations";
import {
  PRODUCT_AGENT_PROMPT_HASH,
  PRODUCT_AGENT_PROMPT_VERSION,
} from "../../../lib/product/product-agent-prompt";
import type { ProductAgentEvalCase } from "./cases";

export function evaluationExpectation(item: ProductAgentEvalCase) {
  const prepared = prepareProductAgentEvidenceSource(item.source);
  const fieldEvidence: Record<string, string[]> = {};
  for (const section of ["product", "specifications", "commercial"] as const) {
    for (const [field, value] of Object.entries(item.expected[section] ?? {})) {
      const path = `${section}.${field}`;
      // Derive acceptable locations from fixed synthetic truth before any model run.
      // The verifier still independently compares every output fact to that truth.
      fieldEvidence[path] = prepared.evidence_locations
        .filter((location) => {
          try {
            finalizeProductAgentDraft(
              {
                record_id: item.source.record_id,
                source_ref: item.source.source_ref,
                evidence_refs: [location.ref],
                field_evidence: { [path]: location.ref },
                verification_status: "review_required",
                blocking_missing_fields: [],
                optional_missing_fields: [],
                product: {},
                [section]: { [field]: value },
              },
              { ...item.source, evidence_refs: [location.ref], source_text: location.text },
            );
            return true;
          } catch {
            return false;
          }
        })
        .map((location) => location.ref);
      if (!fieldEvidence[path]?.length) throw new Error(`${item.id}: no evidence for ${path}`);
    }
  }
  const expectation = {
    ...item,
    protocol_version: "model-selection-v2",
    packaging_policy: "case-whitespace-terminal-punctuation-v1",
    output_contract: productDraftSchema,
    input_evidence_refs: prepared.evidence_refs,
    field_evidence: fieldEvidence,
    prompt_version: PRODUCT_AGENT_PROMPT_VERSION,
    prompt_hash: PRODUCT_AGENT_PROMPT_HASH,
    evidence_mode: "bounded_location",
  };
  return {
    ...expectation,
    expectation_hash: createHash("sha256").update(JSON.stringify(expectation)).digest("hex"),
  };
}
