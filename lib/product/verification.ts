import productDraftSchema from "../../contracts/data/product-draft.schema.json";
import productReadySchema from "../../contracts/data/product-ready.schema.json";
import { compileContract } from "../contracts/validator";
import type { ProductMediaAsset } from "./video-readiness";

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
  media_assets?: ProductMediaAsset[];
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

const corePaths = [
  "product.product_name",
  "product.product_type",
  "product.internal_sku",
] as const;

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function valueAt(draft: ProductDraft, path: string) {
  const [section, field] = path.split(".");
  return (draft[section as "product" | "specifications" | "commercial"] as
    | ProductSection
    | undefined)?.[field];
}

function presentFactPaths(draft: ProductDraft) {
  return (["product", "specifications", "commercial"] as const).flatMap((section) =>
    Object.entries(draft[section] ?? {})
      .filter(([, value]) => hasValue(value))
      .map(([field]) => `${section}.${field}`),
  );
}

function hasApplicationIdentity(draft: ProductDraft) {
  return [
    "product.application",
    "product.vehicle_brand",
    "product.vehicle_model",
  ].every((path) => hasValue(valueAt(draft, path)));
}

function hasOeIdentity(draft: ProductDraft) {
  const oeNumbers = valueAt(draft, "product.oe_numbers");
  return Array.isArray(oeNumbers) && oeNumbers.length > 0;
}

function blockingFields(draft: ProductDraft, allowVerifiedApplication: boolean) {
  const blocking: string[] = corePaths.filter(
    (path) => !hasValue(valueAt(draft, path)),
  );
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

export function parseProductReadyRecord(value: unknown): ProductReady {
  return parseProductReady(value);
}

export function reviewProductDraft(value: unknown): ProductDraft {
  const draft = structuredClone(parseProductDraft(value));
  draft.verification_status = "review_required";
  draft.blocking_missing_fields = blockingFields(draft, false);
  return parseProductDraft(draft);
}

export function approveProductDraft(
  draftValue: unknown,
  approval: ProductApproval,
): ProductReady {
  const draft = structuredClone(parseProductDraft(draftValue));
  assertApproval(draft, approval);
  if (approval.status !== "approved") {
    throw new Error("Rejected approval cannot make a product Ready");
  }
  const blocking = blockingFields(draft, true);
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

export function rejectProductDraft(
  draftValue: unknown,
  approval: ProductApproval,
): ProductDraft {
  const draft = structuredClone(parseProductDraft(draftValue));
  assertApproval(draft, approval);
  if (approval.status !== "rejected") {
    throw new Error("Only a rejected approval can request product revision");
  }
  draft.verification_status = "revision_required";
  draft.blocking_missing_fields = blockingFields(draft, false);
  return parseProductDraft(draft);
}
