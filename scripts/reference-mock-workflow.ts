import assert from "node:assert/strict";

import { finalizeProductAgentDraft, type ProductAgentSource } from "../lib/product/agent";
import {
  assertProductAgentEvidenceLocations,
  prepareProductAgentEvidenceSource,
} from "../lib/product/evidence-locations";
import {
  approveProductDraft,
  type ProductApproval,
  type ProductDraft,
  rejectProductDraft,
} from "../lib/product/verification";
import { runSyntheticDemo } from "./run-synthetic-demo";

/** Local test runner only. Never persist its Ready objects as factory-approved business data. */
export async function runReferenceMockWorkflow(
  source: ProductAgentSource,
  original: ProductDraft,
  slot: number,
) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 20) throw new Error("Invalid test slot");
  const originalSnapshot = JSON.stringify(original);
  const sourceSnapshot = JSON.stringify(source);
  const baseSource = prepareProductAgentEvidenceSource(source);
  const checked = finalizeProductAgentDraft(original, baseSource);
  assertProductAgentEvidenceLocations(checked, baseSource, finalizeProductAgentDraft);
  if (!checked.product.internal_sku)
    throw new Error("Reference test requires a sourced identifier");
  const token = String(slot).padStart(2, "0");
  const recordId = `synthetic-reference-slot-${token}`;
  const testSourceRef = `synthetic:reference-composite-${token}`;
  const initial = { ...structuredClone(checked), record_id: recordId, source_ref: testSourceRef };
  const decision: ProductApproval = {
    approval_id: `synthetic-reference-approval-${token}`,
    gate: "gate_01_truth",
    entity_type: "product",
    entity_id: recordId,
    status: "approved",
    decision: {
      actor_type: "human",
      decided_by: "synthetic-test-reviewer",
      decided_at: new Date().toISOString(),
      evidence_ref: `synthetic:test-decision-${token}`,
      notes:
        "SIMULATED decision authorized by the user for mock data; no real reviewer or factory approval.",
    },
  };
  if (!initial.blocking_missing_fields.length)
    throw new Error("Expected an incomplete reference draft");
  assert.throws(() => approveProductDraft(initial, decision), /Product cannot be Ready/);
  const rejected = rejectProductDraft(initial, { ...decision, status: "rejected" });
  assert.equal(rejected.verification_status, "revision_required");

  const supplement: Record<string, { value: unknown; label: string }> = {};
  if (!initial.product.product_name)
    supplement.product_name = { value: `MOCK test product ${token}`, label: "Product name" };
  if (!initial.product.product_type)
    supplement.product_type = { value: "clutch_kit", label: "Product type" };
  if (!Array.isArray(initial.product.oe_numbers) || !initial.product.oe_numbers.length)
    supplement.oe_numbers = { value: [`MOCK-OE-SLOT-${token}`], label: "OE" };
  const mockSource = prepareProductAgentEvidenceSource({
    record_id: recordId,
    source_ref: `synthetic:mock-supplement-${token}`,
    evidence_refs: [`synthetic:mock-supplement-${token}`],
    source_text: [
      "MOCK TEST SUPPLEMENT. Not PDF facts or factory claims.",
      ...Object.values(supplement).map(
        (x) => `${x.label}: ${Array.isArray(x.value) ? x.value.join(", ") : x.value}`,
      ),
    ].join("\n"),
    image_availability: "none",
    image_refs: [],
  });
  const combinedSource = {
    ...baseSource,
    record_id: recordId,
    source_ref: testSourceRef,
    source_text: `${baseSource.source_text}\n\n${mockSource.source_text}`,
    evidence_refs: [...baseSource.evidence_refs, ...mockSource.evidence_refs],
    evidence_locations: [...baseSource.evidence_locations, ...mockSource.evidence_locations],
  };
  const candidate = { ...structuredClone(initial), evidence_refs: combinedSource.evidence_refs };
  for (const [field, item] of Object.entries(supplement)) {
    const location = mockSource.evidence_locations.find((x) => x.text.startsWith(`${item.label}:`));
    assert.ok(location);
    candidate.product[field] = item.value;
    candidate.field_evidence[`product.${field}`] = location.ref;
  }
  for (const [field, value] of Object.entries(checked.product))
    assert.deepEqual(candidate.product[field], value, `Source field changed: ${field}`);
  const revised = finalizeProductAgentDraft(candidate, combinedSource);
  assertProductAgentEvidenceLocations(revised, combinedSource, finalizeProductAgentDraft);
  assert.deepEqual(revised.blocking_missing_fields, []);
  const withoutEvidence = structuredClone(revised);
  delete withoutEvidence.field_evidence["product.product_name"];
  assert.throws(() => approveProductDraft(withoutEvidence, decision), /field_evidence/);
  const ready = approveProductDraft(revised, decision);
  const downstream = await runSyntheticDemo(ready);
  assert.equal(downstream.finalStates.lead, "OPPORTUNITY");
  assert.equal(JSON.stringify(original), originalSnapshot);
  assert.equal(JSON.stringify(source), sourceSnapshot);
  return {
    classification: "reference_with_synthetic_supplements" as const,
    execution_mode: "local_domain_simulation" as const,
    live_publication: false,
    business_database_writes: false,
    real_factory_approval: false,
    slot,
    original_record_id: original.record_id,
    original_source_ref: original.source_ref,
    mocked_fields: Object.keys(supplement).map((k) => `product.${k}`),
    mock_source: mockSource,
    initial_blocking_fields: initial.blocking_missing_fields,
    incomplete_approval_rejected: true,
    rejection_status: rejected.verification_status,
    revision_rounds: 1,
    ready,
    downstream,
  };
}
