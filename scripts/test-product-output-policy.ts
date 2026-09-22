import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020";
import { productAgentEvalCases } from "../evals/harbor/product-agent/cases";
import { evaluationExpectation } from "../evals/harbor/product-agent/expectations";
import { createProductAgentModel } from "../lib/ai/model-provider";
import { resolveProductOutputPolicy } from "../lib/ai/product-output-policy";
import { EvidenceLocatedProductAgent } from "../lib/product/evidence-located-agent";
import { PRODUCT_OUTPUT_SCHEMA } from "../lib/product/output-contract";

async function main() {
  const config = {
    provider: "openai-compatible" as const,
    model: "mimo-v2.6-flash",
    providerOptions: { apiKey: "synthetic", baseURL: "https://token-plan-cn.xiaomimimo.com/v1" },
  };
  assert.equal(resolveProductOutputPolicy(config).mode, "json");
  assert.equal(
    resolveProductOutputPolicy({
      ...config,
      model: "kimi-k3",
      providerOptions: { ...config.providerOptions, baseURL: "https://api.moonshot.cn/v1" },
    }).mode,
    "json_schema",
  );
  assert.equal(
    resolveProductOutputPolicy({
      ...config,
      providerOptions: { ...config.providerOptions, baseURL: "https://unverified.example/v1" },
    }).mode,
    "text",
  );
  assert.throws(() => resolveProductOutputPolicy({ ...config, outputMode: "invalid" as never }));
  const item = productAgentEvalCases[0];
  assert.ok(item);
  const expected = evaluationExpectation(item);
  const schema = PRODUCT_OUTPUT_SCHEMA as {
    properties: Record<string, { properties?: Record<string, unknown> }>;
  };
  const candidate: Record<string, unknown> = {
    record_id: item.source.record_id,
    source_ref: item.source.source_ref,
    verification_status: "review_required",
    evidence_refs: [],
    blocking_missing_fields: [],
    optional_missing_fields: [],
  };
  for (const section of ["product", "specifications", "commercial"] as const) {
    candidate[section] = Object.fromEntries(
      Object.keys(schema.properties[section]?.properties ?? {}).map((key) => [
        key,
        (item.expected[section] as Record<string, unknown> | undefined)?.[key] ?? null,
      ]),
    );
  }
  candidate.field_evidence = Object.fromEntries(
    Object.keys(schema.properties.field_evidence?.properties ?? {}).map((key) => [
      key,
      expected.field_evidence[key]?.[0] ?? null,
    ]),
  );
  const validateWire = new Ajv({ strict: true }).compile(PRODUCT_OUTPUT_SCHEMA as object);
  assert.equal(validateWire(candidate), true, JSON.stringify(validateWire.errors));
  const invalid = structuredClone(candidate);
  (invalid.specifications as Record<string, unknown>).clutch_diameter_mm = "240 mm";
  assert.equal(validateWire(invalid), false, "wire schema rejects string numbers");
  for (const mode of ["json_schema", "json", "text"] as const) {
    let requests = 0;
    const model = createProductAgentModel({
      ...config,
      outputMode: mode,
      providerOptions: {
        ...config.providerOptions,
        fetch: async (_url, init) => {
          requests++;
          const request = JSON.parse(init?.body as string);
          assert.equal(
            request.response_format?.type,
            mode === "text" ? undefined : mode === "json" ? "json_object" : "json_schema",
          );
          if (mode === "json_schema")
            assert.equal(request.response_format.json_schema.strict, true);
          const input = JSON.parse(
            request.messages.find((m: { role: string }) => m.role === "user").content[0].text,
          );
          const response = { ...candidate, evidence_refs: input.evidence_refs };
          return new Response(
            JSON.stringify({
              id: "synthetic",
              object: "chat.completion",
              created: 0,
              model: config.model,
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: { role: "assistant", content: JSON.stringify(response) },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        },
      },
    });
    const observations: unknown[] = [];
    const result = await new EvidenceLocatedProductAgent().run({
      model,
      source: item.source,
      observe_model_response: (observation) => observations.push(observation),
    });
    assert.equal(observations.length, 1);
    assert.equal(result.metadata.usage?.totalTokens, 30);
    assert.equal(requests, 1);
    assert.equal(result.metadata.output_mode, mode);
    assert.deepEqual(result.draft.product, item.expected.product);
    assert.deepEqual(result.draft.specifications, item.expected.specifications);
    assert.deepEqual(result.draft.commercial, {});
    assert.equal(
      Object.values(result.draft.field_evidence).some((x) => x === null),
      false,
    );
    (candidate.specifications as Record<string, unknown>).clutch_diameter_mm = 241;
    const rejectedResponses: unknown[] = [];
    await assert.rejects(
      new EvidenceLocatedProductAgent().run({
        model,
        source: item.source,
        observe_model_response: (response) => rejectedResponses.push(response),
      }),
      /must match an explicitly labelled source value/,
    );
    assert.equal(rejectedResponses.length, 1, "retain response when source validation rejects it");
    (candidate.specifications as Record<string, unknown>).clutch_diameter_mm = 240;
  }
  let calls = 0;
  const unsupported = createProductAgentModel({
    ...config,
    outputMode: "json_schema",
    providerOptions: {
      ...config.providerOptions,
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            error: { message: "Unsupported schema", type: "invalid_request_error" },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  });
  await assert.rejects(
    new EvidenceLocatedProductAgent().run({ model: unsupported, source: item.source }),
  );
  assert.equal(calls, 1, "unsupported schema must not silently retry as text");
  console.log(
    "PASS structured wire schema, actual request modes, null-to-absence semantics, and no silent fallback",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
