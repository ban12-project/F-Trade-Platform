import { expect, test } from "@playwright/test";

import { createProductAgentModel, parseModelId } from "../../lib/ai/model-provider";
import {
  finalizeProductAgentDraft,
  validateProductAgentSource,
  type ProductAgentSource,
} from "../../lib/product/agent";
import { discoverCatalogCandidates } from "../../lib/product/catalog-candidates";

const source: ProductAgentSource = {
  record_id: "synthetic-product-agent-test",
  source_ref: "synthetic-source-test",
  evidence_refs: ["synthetic-source-test"],
  source_text: "Synthetic test only. OEM No. SYN-OE-001",
  image_availability: "none",
  image_refs: [],
};

const safeDraft = {
  record_id: source.record_id,
  source_ref: source.source_ref,
  evidence_refs: source.evidence_refs,
  field_evidence: {
    "product.product_name": source.source_ref,
    "product.product_type": source.source_ref,
    "product.internal_sku": source.source_ref,
    "product.oe_numbers": source.source_ref,
  },
  verification_status: "review_required",
  blocking_missing_fields: [],
  optional_missing_fields: [],
  product: {
    product_name: "Synthetic Clutch Kit",
    product_type: "clutch_kit",
    internal_sku: "SYN-TEST-001",
    oe_numbers: ["SYN-OE-001"],
  },
};

test("accepts only provider/model identifiers", () => {
  expect(parseModelId("openai/gpt-test")).toEqual({ provider: "openai", model: "gpt-test" });
  expect(parseModelId("openai-compatible/gpt-test")).toEqual({
    provider: "openai-compatible",
    model: "gpt-test",
  });
  expect(() => parseModelId("gpt-test")).toThrow("provider/model");
  expect(() => parseModelId("unknown/model")).toThrow("provider/model");
});

test("fails closed when a selected provider has no key", () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  expect(() => createProductAgentModel("openai/gpt-test")).toThrow("OPENAI_API_KEY");
  if (original) process.env.OPENAI_API_KEY = original;
});

test("fails closed when an OpenAI-compatible endpoint is incomplete", () => {
  const originalKey = process.env.F_TRADE_OPENAI_COMPATIBLE_API_KEY;
  const originalBaseUrl = process.env.F_TRADE_OPENAI_COMPATIBLE_BASE_URL;
  delete process.env.F_TRADE_OPENAI_COMPATIBLE_API_KEY;
  delete process.env.F_TRADE_OPENAI_COMPATIBLE_BASE_URL;
  expect(() => createProductAgentModel("openai-compatible/gpt-test")).toThrow(
    "F_TRADE_OPENAI_COMPATIBLE_BASE_URL",
  );
  if (originalKey) process.env.F_TRADE_OPENAI_COMPATIBLE_API_KEY = originalKey;
  if (originalBaseUrl) process.env.F_TRADE_OPENAI_COMPATIBLE_BASE_URL = originalBaseUrl;
});

test("finalizes only source-backed review drafts", () => {
  expect(finalizeProductAgentDraft(safeDraft, source).verification_status).toBe("review_required");
  expect(() =>
    finalizeProductAgentDraft(
      { ...safeDraft, verification_status: "unverified" },
      source,
    ),
  ).toThrow("review_required");
  expect(() =>
    finalizeProductAgentDraft(
      {
        ...safeDraft,
        field_evidence: { ...safeDraft.field_evidence, "specifications.spline_count": "invented" },
      },
      source,
    ),
  ).toThrow("evidence for exactly its populated facts");
});

test("rejects invalid source image and injection envelopes before model invocation", () => {
  expect(() => validateProductAgentSource({ ...source, image_refs: ["not-allowed"] })).toThrow(
    "No-image",
  );
  expect(() =>
    validateProductAgentSource({ ...source, image_availability: "real_product_image" }),
  ).toThrow("must include a real image reference");
  expect(validateProductAgentSource(source)).toEqual(source);
});

test("scopes catalog candidates without treating the selector as evidence", () => {
  const candidates = discoverCatalogCandidates({
    ...source,
    source_text: "header RYC251 explicit row facts RYC251 footer RYC302 other row 10XDC200 Qidie row",
  });
  expect(candidates.map((candidate) => candidate.identifier)).toEqual(["RYC251", "RYC302", "10XDC200"]);
  expect(candidates[0]?.source.record_id).toBe("synthetic-product-agent-test-ryc251");
  expect(candidates[0]?.source.candidate_identifier).toBe("RYC251");
  expect(candidates[0]?.source.evidence_refs).toEqual(source.evidence_refs);
});

test("rejects an adjacent catalog identifier for a selected candidate", () => {
  expect(() =>
    finalizeProductAgentDraft(
      { ...safeDraft, product: { ...safeDraft.product, internal_sku: "RYC302" } },
      { ...source, candidate_identifier: "RYC251" },
    ),
  ).toThrow("must match the selected catalog candidate");
});

test("removes null optional facts without creating a sourced value", () => {
  const draft = finalizeProductAgentDraft(
    {
      ...safeDraft,
      product: { ...safeDraft.product, vehicle_model: null },
      field_evidence: { ...safeDraft.field_evidence, "product.vehicle_model": source.source_ref },
    },
    source,
  );
  expect(draft.product.vehicle_model).toBeUndefined();
  expect(draft.field_evidence["product.vehicle_model"]).toBeUndefined();
});

test("rejects OE numbers when the source has no OE or OEM label", () => {
  expect(() =>
    finalizeProductAgentDraft(safeDraft, { ...source, source_text: "Part No. SYN-OE-001" }),
  ).toThrow("explicitly listed under an OE or OEM No. source label");
});

test("rejects an OE value that is not listed under the source label", () => {
  expect(() =>
    finalizeProductAgentDraft(
      {
        ...safeDraft,
        product: { ...safeDraft.product, oe_numbers: ["SYN-OE-HALLUCINATED"] },
      },
      source,
    ),
  ).toThrow("explicitly listed under an OE or OEM No. source label");
});

test("does not treat an incidental OEM word as an OE source label", () => {
  expect(() =>
    finalizeProductAgentDraft(safeDraft, {
      ...source,
      source_text: "This OEM replacement is identified only by Part No. SYN-OE-001",
    }),
  ).toThrow("explicitly listed under an OE or OEM No. source label");
});

test("accepts every OE value explicitly listed under the source label", () => {
  const labelledSource = {
    ...source,
    source_text: "OEM No.: SYN-OE-001, SYN-OE-002",
  };
  const draft = {
    ...safeDraft,
    product: { ...safeDraft.product, oe_numbers: ["SYN-OE-002", "SYN-OE-001"] },
  };
  expect(finalizeProductAgentDraft(draft, labelledSource).product.oe_numbers).toEqual([
    "SYN-OE-002",
    "SYN-OE-001",
  ]);
});
