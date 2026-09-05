import { expect, test } from "@playwright/test";

import productDraftFixture from "../../data/fixtures/product-draft.synthetic.json";
import {
  approveProductDraft,
  type ProductApproval,
  rejectProductDraft,
  reviewProductDraft,
} from "../../lib/product/verification";

const approved: ProductApproval = {
  approval_id: "synthetic-product-approval-001",
  gate: "gate_01_truth",
  entity_type: "product",
  entity_id: "synthetic-product-001",
  status: "approved",
  decision: {
    actor_type: "human",
    decided_by: "synthetic-reviewer",
    decided_at: "2026-08-24T12:00:00Z",
    evidence_ref: "synthetic-human-review-001",
  },
};

test("keeps an unverified application identity in review", () => {
  const draft = reviewProductDraft(productDraftFixture);
  expect(draft.verification_status).toBe("review_required");
  expect(draft.blocking_missing_fields).toContain("oe_numbers_or_verified_application");
});

test("keeps a draft with a missing core field in review", () => {
  const incomplete = structuredClone(productDraftFixture);
  delete (incomplete.product as Record<string, unknown>).internal_sku;
  delete (incomplete.field_evidence as Record<string, string>)["product.internal_sku"];

  const draft = reviewProductDraft(incomplete);
  expect(draft.verification_status).toBe("review_required");
  expect(draft.blocking_missing_fields).toContain("product.internal_sku");
});

test("allows a human to verify a sourced application identity", () => {
  const ready = approveProductDraft(productDraftFixture, approved);
  expect(ready.verification_status).toBe("verified");
  expect(ready.blocking_missing_fields).toEqual([]);
  expect(ready.approval_ref).toBe(approved.approval_id);
  expect(ready.evidence_refs).toContain(approved.decision.evidence_ref);
});

test("rejects a supplied engineering field without field evidence", () => {
  const draft = structuredClone(productDraftFixture);
  delete (draft.field_evidence as Record<string, string>)["specifications.kit_contents"];

  expect(() => approveProductDraft(draft, approved)).toThrow(
    "field_evidence.specifications.kit_contents",
  );
});

test("rejects an OE identity without field evidence", () => {
  const draft = structuredClone(productDraftFixture);
  (draft.product as Record<string, unknown>).oe_numbers = ["SYN-OE-UNSOURCED"];

  expect(() => approveProductDraft(draft, approved)).toThrow("field_evidence.product.oe_numbers");
});

test("routes a rejected human decision to revision", () => {
  const rejected: ProductApproval = {
    ...approved,
    status: "rejected",
    decision: { ...approved.decision, notes: "Confirm application evidence." },
  };
  const draft = rejectProductDraft(productDraftFixture, rejected);
  expect(draft.verification_status).toBe("revision_required");
});

test("rejects an agent-authored truth approval at runtime", () => {
  const agentApproval = {
    ...approved,
    decision: { ...approved.decision, actor_type: "agent" },
  } as unknown as ProductApproval;

  expect(() => approveProductDraft(productDraftFixture, agentApproval)).toThrow(
    "Product approval requires a human actor",
  );
});
