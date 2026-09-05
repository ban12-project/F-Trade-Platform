import { expect, test } from "@playwright/test";
import { z } from "zod";
import { createProductAgentModel } from "../../lib/ai/model-provider";
import { AiSdkStructuredGenerator } from "../../lib/ai/structured-generator";
import {
  assertGeneratedFitmentLiteral,
  generateMarketingContent,
} from "../../lib/content/generation";

test("compatible content generation sends Chat Completions with the selected model and evidence", async () => {
  const draft = {
    hook: "MOCK test-only product",
    body: "Review the synthetic test product.",
    callToAction: "Discuss the test workflow.",
    hashtags: ["#MockTest"],
    visualInstruction: "Use a text card with a MOCK watermark.",
  };
  let requestBody:
    | {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format: { type: string };
      }
    | undefined;
  const model = createProductAgentModel({
    provider: "openai-compatible",
    model: "kimi-k3",
    providerOptions: {
      apiKey: "synthetic-key",
      baseURL: "https://model.example.invalid/v1",
      fetch: async (url, init) => {
        expect(String(url)).toBe("https://model.example.invalid/v1/chat/completions");
        requestBody = JSON.parse(String(init?.body));
        return Response.json({
          id: "synthetic-response",
          object: "chat.completion",
          created: 1,
          model: "kimi-k3",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(draft) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    },
  });
  const verifiedFacts = [
    { field: "product.product_name", value: "MOCK fixture", evidenceRef: "synthetic:mock-name" },
  ];
  expect(
    await generateMarketingContent({
      model,
      contentType: "product",
      objective: "Test only",
      targetCustomer: "Synthetic buyer",
      verifiedFacts,
      syntheticTest: true,
    }),
  ).toEqual(draft);
  expect(requestBody?.model).toBe("kimi-k3");
  const prompt = JSON.parse(
    requestBody?.messages.find((message) => message.role === "user")?.content ?? "null",
  );
  expect(prompt.verifiedFacts).toEqual(verifiedFacts);
  expect(prompt.task).toContain("MOCK simulation");
  expect(requestBody?.response_format.type).toBe("json_schema");
  expect(
    createProductAgentModel({
      provider: "openai",
      model: "synthetic-openai",
      providerOptions: { apiKey: "synthetic-key" },
    }),
  ).toHaveProperty("provider", "openai.responses");
});

test("compatible content generation rejects schema-invalid text", async () => {
  const model = createProductAgentModel({
    provider: "openai-compatible",
    model: "synthetic-model",
    providerOptions: {
      apiKey: "synthetic-key",
      baseURL: "https://model.example.invalid/v1",
      fetch: async () =>
        Response.json({
          id: "synthetic-invalid",
          object: "chat.completion",
          created: 1,
          model: "synthetic-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: '{"body":"Incomplete"}' },
              finish_reason: "stop",
            },
          ],
        }),
    },
  });
  await expect(
    generateMarketingContent({
      model,
      contentType: "product",
      objective: "Test",
      targetCustomer: "Test",
      verifiedFacts: [],
    }),
  ).rejects.toThrow();
});

test("structured product facts still require the exact supplied value and evidence", async () => {
  const verified = {
    field: "product.product_name",
    value: "MOCK fixture",
    evidenceRef: "synthetic:fixture",
  };
  for (const tampered of [false, true]) {
    const output = {
      product_facts: [
        {
          field: verified.field,
          value: tampered ? "Invented product" : verified.value,
          evidence_ref: verified.evidenceRef,
        },
      ],
    };
    const model = createProductAgentModel({
      provider: "openai-compatible",
      model: "synthetic-model",
      providerOptions: {
        apiKey: "synthetic-key",
        baseURL: "https://model.example.invalid/v1",
        fetch: async () =>
          Response.json({
            id: "synthetic-facts",
            object: "chat.completion",
            created: 1,
            model: "synthetic-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(output) },
                finish_reason: "stop",
              },
            ],
          }),
      },
    });
    const result = new AiSdkStructuredGenerator().generate({
      model,
      task: "Synthetic structured facts",
      schemaName: "synthetic_facts",
      schema: z.object({
        product_facts: z.array(
          z.object({ field: z.string(), value: z.string(), evidence_ref: z.string() }),
        ),
      }),
      verifiedFacts: [verified],
    });
    if (tampered) await expect(result).rejects.toThrow("not backed by supplied evidence");
    else await expect(result).resolves.toEqual(output);
  }
});

test("marketing copy preserves compressed fitment values without expanding identifiers", () => {
  const fact = {
    field: "product.vehicle_model",
    value: "SYN100,200 SYN300,400",
    evidenceRef: "synthetic:models",
  };
  const draft = {
    hook: "MOCK",
    body: fact.value,
    callToAction: "Discuss test",
    hashtags: [],
    visualInstruction: "Text card",
  };
  expect(() => assertGeneratedFitmentLiteral(draft, [fact])).not.toThrow();
  expect(() =>
    assertGeneratedFitmentLiteral({ ...draft, body: "SYN100, SYN200, SYN300 and SYN400" }, [fact]),
  ).toThrow("complete product.vehicle_model");
  expect(() =>
    assertGeneratedFitmentLiteral({ ...draft, body: "SYN100,200\nSYN300,400" }, [fact]),
  ).toThrow();
  expect(() =>
    assertGeneratedFitmentLiteral({ ...draft, body: "General transport" }, [
      { ...fact, field: "product.application", value: "Specific synthetic application" },
    ]),
  ).toThrow("complete product.application");
});
