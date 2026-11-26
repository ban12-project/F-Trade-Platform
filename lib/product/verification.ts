import productDraftSchema from "../../contracts/data/product-draft.schema.json";
import productReadySchema from "../../contracts/data/product-ready.schema.json";
import { compileContract } from "../contracts/validator";
import { productBlockingFields } from "./blocking-fields";

type ProductSection = Record<string, unknown>;

export interface ProductDraft {
  record_id: string;
  source_ref: string;
  evidence_refs: string[];
  field_evidence: Record<string, string>;
  verification_status: "unverified" | "review_required" | "revision_required";
  blocking_missing_fields: string[];
  optional_missing_fields: string[];
  product: ProductSection;
  specifications?: ProductSection;
  commercial?: ProductSection;
}

export interface ProductReady extends Omit<ProductDraft, "verification_status"> {
  verification_status: "verified";
  approval_ref: string;
}

export interface ProductApproval {
  approval_id: string;
  gate: "gate_01_truth";
  entity_type: "product";
  entity_id: string;
  status: "approved" | "rejected";
  decision: {
    actor_type: "human";
    decided_by: string;
    decided_at: string;
    evidence_ref: string;
    notes?: string;
  };
}

const parseProductDraft = compileContract<ProductDraft>(productDraftSchema);
const parseProductReady = compileContract<ProductReady>(productReadySchema);

function assertApproval(draft: ProductDraft, approval: ProductApproval) {
  if (
    approval.gate !== "gate_01_truth" ||
    approval.entity_type !== "product" ||
    approval.entity_id !== draft.record_id
  ) {
    throw new Error("Approval does not belong to this product");
  }
  if (approval.decision.actor_type !== "human") {
    throw new Error("Product approval requires a human actor");
  }
  if (!approval.decision.decided_by.trim() || !approval.decision.evidence_ref.trim()) {
    throw new Error("Product approval requires reviewer and evidence");
  }
  if (Number.isNaN(Date.parse(approval.decision.decided_at))) {
    throw new Error("Product approval requires a valid decision time");
  }
}

export function reviewProductDraft(value: unknown): ProductDraft {
  const draft = structuredClone(parseProductDraft(value));
  draft.verification_status = "review_required";
  draft.blocking_missing_fields = productBlockingFields(draft, false);
  return parseProductDraft(draft);
}

export function approveProductDraft(draftValue: unknown, approval: ProductApproval): ProductReady {
  const draft = structuredClone(parseProductDraft(draftValue));
  assertApproval(draft, approval);
  if (approval.status !== "approved") {
    throw new Error("Rejected approval cannot make a product Ready");
  }
  const blocking = productBlockingFields(draft, true);
  if (blocking.length > 0) {
    throw new Error(`Product cannot be Ready: ${blocking.join(", ")}`);
  }

  const evidenceRefs = [...new Set([...draft.evidence_refs, approval.decision.evidence_ref])];
  return parseProductReady({
    ...draft,
    evidence_refs: evidenceRefs,
    verification_status: "verified",
    blocking_missing_fields: [],
    approval_ref: approval.approval_id,
  });
}

export function rejectProductDraft(draftValue: unknown, approval: ProductApproval): ProductDraft {
  const draft = structuredClone(parseProductDraft(draftValue));
  assertApproval(draft, approval);
  if (approval.status !== "rejected") {
    throw new Error("Only a rejected approval can request product revision");
  }
  draft.verification_status = "revision_required";
  draft.blocking_missing_fields = productBlockingFields(draft, false);
  return parseProductDraft(draft);
}
