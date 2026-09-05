import { expect, test } from "@playwright/test";
import { getHarborEvaluationModelConfig } from "../../lib/ai/harbor-evaluation-model";
import {
  createProductAgentModel,
  validateProductAgentModelConfig,
} from "../../lib/ai/model-provider";
import { productAgentModelSettingsSchema, productAgentRunFormSchema } from "../../lib/form-schemas";
import {
  finalizeProductAgentDraft,
  type ProductAgentSource,
  validateProductAgentSource,
} from "../../lib/product/agent";
import { discoverCatalogCandidates } from "../../lib/product/catalog-candidates";

const source: ProductAgentSource = {
  record_id: "synthetic-product-agent-test",
  source_ref: "synthetic-source-test",
  evidence_refs: ["synthetic-source-test"],
  source_text: [
    "Product name: Synthetic Clutch Kit",
    "Product type: clutch_kit",
    "Internal SKU: SYN-TEST-001",
    "OEM No. SYN-OE-001",
  ].join("\n"),
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

test("validates the persisted provider configuration without allowing plaintext credential headers", () => {
  const input = {
    configId: "",
    name: "Synthetic gateway",
    isDefault: true,
    provider: "openai-compatible",
    model: "gateway-model",
    baseUrl: "https://gateway.example.test/v1",
    headersJson: '{"X-Tenant":"f-trade"}',
    providerName: "gateway",
    organization: "",
    project: "",
    apiKey: "",
    authToken: "",
    clearApiKey: false,
    clearAuthToken: false,
  };
  expect(productAgentModelSettingsSchema.safeParse(input).success).toBe(true);
  expect(
    productAgentModelSettingsSchema.safeParse({
      ...input,
      headersJson: '{"Authorization":"Bearer should-not-be-plaintext"}',
    }).success,
  ).toBe(false);
});

test("accepts only an authorized, bounded Product Agent text envelope", () => {
  expect(
    productAgentRunFormSchema.safeParse({
      modelConfigId: "00000000-0000-4000-8000-000000000501",
      model: "gpt-5-mini",
      sourceRef: "source-catalog-001",
      evidenceRef: "evidence-catalog-001",
      sourceText: "Product name: Synthetic Clutch Kit\nProduct type: clutch_kit",
      hasUpload: false,
    }).success,
  ).toBe(true);
  expect(
    productAgentRunFormSchema.safeParse({
      modelConfigId: "00000000-0000-4000-8000-000000000501",
      model: "gpt-5-mini",
      sourceRef: "/tmp/factory.xlsx",
      evidenceRef: "evidence-catalog-001",
      sourceText: "Product name: Synthetic Clutch Kit\nProduct type: clutch_kit",
      hasUpload: false,
    }).success,
  ).toBe(false);
});

test("fails closed when a saved provider has no key", () => {
  expect(() =>
    createProductAgentModel({
      provider: "openai",
      model: "gpt-test",
      providerOptions: {},
    }),
  ).toThrow("Saved openai provider requires an API key");
});

test("fails closed when a saved OpenAI-compatible provider has no endpoint", () => {
  expect(() =>
    createProductAgentModel({
      provider: "openai-compatible",
      model: "gpt-test",
      providerOptions: { apiKey: "test-key" },
    }),
  ).toThrow("Saved OpenAI-compatible provider requires a Base URL");
});

test("rejects saving a provider configuration without an authentication method", () => {
  expect(() =>
    validateProductAgentModelConfig({
      provider: "openai-compatible",
      model: "gateway-model",
      providerOptions: { baseURL: "https://gateway.example.test/v1" },
    }),
  ).toThrow("API key");
  expect(() =>
    validateProductAgentModelConfig({
      provider: "anthropic",
      model: "claude-test",
      providerOptions: {},
    }),
  ).toThrow("API key or Auth token");
});

test("uses only the selected provider's injected Harbor credential", () => {
  expect(
    getHarborEvaluationModelConfig({
      HARBOR_MODEL: "openai-compatible/gateway-model",
      HARBOR_OPENAI_COMPATIBLE_BASE_URL: "https://gateway.example.test/v1",
      HARBOR_OPENAI_COMPATIBLE_API_KEY: "synthetic-evaluation-key",
      DATABASE_URL: "must-not-be-read",
      MODEL_CONFIG_ENCRYPTION_KEY: "must-not-be-read",
    }),
  ).toEqual({
    provider: "openai-compatible",
    model: "gateway-model",
    providerOptions: {
      baseURL: "https://gateway.example.test/v1",
      apiKey: "synthetic-evaluation-key",
    },
  });
  expect(() => getHarborEvaluationModelConfig({ HARBOR_MODEL: "openai/gpt-test" })).toThrow(
    "HARBOR_OPENAI_API_KEY",
  );
  expect(() => getHarborEvaluationModelConfig({ HARBOR_MODEL: "unknown/model" })).toThrow(
    "HARBOR_MODEL",
  );
});

test("finalizes only source-backed review drafts", () => {
  expect(finalizeProductAgentDraft(safeDraft, source).verification_status).toBe("review_required");
  expect(() =>
    finalizeProductAgentDraft({ ...safeDraft, verification_status: "unverified" }, source),
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
    validateProductAgentSource({
      ...source,
      image_availability: "real_product_image",
      image_refs: ["synthetic/front.png"],
    }),
  ).toThrow("bytes for every image reference");
  expect(
    validateProductAgentSource({
      ...source,
      image_availability: "real_product_image",
      image_refs: ["synthetic/front.png"],
      image_inputs: [
        {
          ref: "synthetic/front.png",
          media_type: "image/png",
          data_base64: "iVBORw0KGgo=",
        },
      ],
    }).image_inputs,
  ).toHaveLength(1);
  expect(validateProductAgentSource(source)).toEqual(source);
});

test("scopes catalog candidates without treating the selector as evidence", () => {
  const candidates = discoverCatalogCandidates({
    ...source,
    source_text: [
      "| Kit No. | Product name | Product type | OEM No. | Clutch diameter |",
      "| --- | --- | --- | --- | --- |",
      "| RYC251 | Synthetic Kit 251 | clutch_kit | OE-251 | 240 mm |",
      "| RYC302 | Synthetic Kit 302 | clutch_kit | OE-302 | 250 mm |",
      "",
      "Part No.: 10XDC200\nProduct name: Qidie disc",
    ].join("\n"),
  });
  expect(candidates.map((candidate) => candidate.identifier)).toEqual([
    "RYC251",
    "RYC302",
    "10XDC200",
  ]);
  expect(candidates[0]?.source.record_id).toBe("synthetic-product-agent-test-record-3");
  expect(candidates[0]?.source.candidate_identifier).toBe("RYC251");
  expect(candidates[0]?.source.evidence_refs).toEqual([`${source.evidence_refs[0]}#record-line=3`]);
  expect(candidates[0]?.source.source_ref).toBe(source.source_ref);
  expect(candidates[0]?.review_status).toBe("source_review_required");
  expect(candidates[0]?.source.source_text).toContain("OE-251");
  expect(candidates[0]?.source.source_text).not.toContain("RYC302");
});

test("rejects facts copied from an adjacent catalog table row", () => {
  const candidate = discoverCatalogCandidates({
    ...source,
    source_text: [
      "| Kit No. | Product name | Product type | OEM No. |",
      "| --- | --- | --- | --- |",
      "| RYC251 | Synthetic Kit 251 | clutch_kit | OE-251 |",
      "| RYC302 | Synthetic Kit 302 | clutch_kit | OE-302 |",
    ].join("\n"),
  })[0]!;
  const draft = {
    ...safeDraft,
    record_id: candidate.source.record_id,
    product: {
      product_name: "Synthetic Kit 251",
      product_type: "clutch_kit",
      internal_sku: "RYC251",
      oe_numbers: ["OE-302"],
    },
  };
  expect(() => finalizeProductAgentDraft(draft, candidate.source)).toThrow(
    "explicitly listed under an OE or OEM No. source label",
  );
});

test("rejects an adjacent catalog identifier for a selected candidate", () => {
  expect(() =>
    finalizeProductAgentDraft(
      { ...safeDraft, product: { ...safeDraft.product, internal_sku: "RYC302" } },
      {
        ...source,
        source_text: source.source_text.replace(
          "Internal SKU: SYN-TEST-001",
          "Internal SKU: RYC302",
        ),
        candidate_identifier: "RYC251",
      },
    ),
  ).toThrow("must match the selected catalog candidate");
});

test("reads OE values from the matching column of a horizontal Markdown table", () => {
  const tableSource = {
    ...source,
    source_text: [
      "| Product name | Product type | Internal SKU | OEM No. | Diameter |",
      "| --- | --- | --- | --- | --- |",
      "| Synthetic Clutch Kit | clutch_kit | SYN-TEST-001 | SYN-OE-001 | 240 mm |",
    ].join("\n"),
  };
  expect(finalizeProductAgentDraft(safeDraft, tableSource).product.oe_numbers).toEqual([
    "SYN-OE-001",
  ]);
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
    source_text: source.source_text.replace(
      "OEM No. SYN-OE-001",
      "OEM No.: SYN-OE-001, SYN-OE-002",
    ),
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

test("rejects restricted engineering and commercial values missing from labelled source facts", () => {
  const unsupportedFacts = {
    ...safeDraft,
    specifications: { spline_count: 999 },
    commercial: { moq: 500 },
    field_evidence: {
      ...safeDraft.field_evidence,
      "specifications.spline_count": source.source_ref,
      "commercial.moq": source.source_ref,
    },
  };
  expect(() => finalizeProductAgentDraft(unsupportedFacts, source)).toThrow(
    "specifications.spline_count must match an explicitly labelled source value",
  );
});

test("rejects unsupported identity and remaining commercial facts", () => {
  expect(() =>
    finalizeProductAgentDraft(
      { ...safeDraft, product: { ...safeDraft.product, product_name: "Invented Kit" } },
      source,
    ),
  ).toThrow("product.product_name must match an explicitly labelled source value");
  expect(() =>
    finalizeProductAgentDraft(
      { ...safeDraft, product: { ...safeDraft.product, product_type: "clutch_disc" } },
      source,
    ),
  ).toThrow("product.product_type must match an explicitly labelled source value");
  expect(() =>
    finalizeProductAgentDraft(
      { ...safeDraft, product: { ...safeDraft.product, internal_sku: "INVENTED-SKU" } },
      source,
    ),
  ).toThrow("product.internal_sku must match an explicitly labelled source value");

  const commercialDraft = {
    ...safeDraft,
    commercial: { packaging: "invented crate", sample_available: true },
    field_evidence: {
      ...safeDraft.field_evidence,
      "commercial.packaging": source.source_ref,
      "commercial.sample_available": source.source_ref,
    },
  };
  expect(() => finalizeProductAgentDraft(commercialDraft, source)).toThrow(
    "commercial.packaging must match an explicitly labelled source value",
  );
  expect(() =>
    finalizeProductAgentDraft(
      {
        ...safeDraft,
        commercial: { sample_available: true },
        field_evidence: {
          ...safeDraft.field_evidence,
          "commercial.sample_available": source.source_ref,
        },
      },
      source,
    ),
  ).toThrow("commercial.sample_available must match an explicitly labelled source value");
  expect(() =>
    finalizeProductAgentDraft(
      {
        ...safeDraft,
        commercial: { supported_customization: "invented logo service" },
        field_evidence: {
          ...safeDraft.field_evidence,
          "commercial.supported_customization": source.source_ref,
        },
      },
      source,
    ),
  ).toThrow("commercial.supported_customization must match an explicitly labelled source value");
});

test("accepts restricted facts only when their labelled source values match", () => {
  const labelledSource = {
    ...source,
    source_text: [
      source.source_text,
      "Vehicle brand: Synthetic",
      "Vehicle model: Demo 01",
      "Spline count: 24",
      "Kit contents: clutch disc, pressure plate, release bearing.",
      "MOQ: 50 pcs.",
    ].join("\n"),
  };
  const labelledFacts = {
    ...safeDraft,
    product: { ...safeDraft.product, vehicle_brand: "Synthetic", vehicle_model: "Demo 01" },
    specifications: {
      spline_count: 24,
      kit_contents: ["clutch_disc", "pressure_plate", "release_bearing"],
    },
    commercial: { moq: 50 },
    field_evidence: {
      ...safeDraft.field_evidence,
      "product.vehicle_brand": source.source_ref,
      "product.vehicle_model": source.source_ref,
      "specifications.spline_count": source.source_ref,
      "specifications.kit_contents": source.source_ref,
      "commercial.moq": source.source_ref,
    },
  };
  expect(finalizeProductAgentDraft(labelledFacts, labelledSource).specifications).toEqual({
    spline_count: 24,
    kit_contents: ["clutch_disc", "pressure_plate", "release_bearing"],
  });
});
