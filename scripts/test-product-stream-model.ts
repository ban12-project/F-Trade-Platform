import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";
import { productStreamFields } from "../lib/product/stream-contract";
import { streamProductProposals } from "../lib/product/stream-model";
import { productStreamModelProposalSchema } from "../lib/product/stream-model-schema";
import {
  emptyProductStreamDraft,
  validateProductStreamProposal,
} from "../lib/product/stream-validation";

type Part =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;
const source = prepareProductAgentEvidenceSource({
  record_id: "synthetic-stream-model",
  source_ref: "source-synthetic",
  evidence_refs: ["evidence-synthetic"],
  source_text: "Product name: Synthetic clutch\nProduct type: clutch_disc",
  image_availability: "none" as const,
  image_refs: [],
});
const proposal = {
  field: "product.product_name",
  value: "Synthetic clutch",
  evidenceRef: source.evidence_locations[0]?.ref,
};
const nextProposal = {
  field: "product.product_type",
  value: "clutch_disc",
  evidenceRef: source.evidence_locations[1]?.ref,
};
const finish: Part = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};

async function verify() {
  for (const field of productStreamFields) {
    assert.equal(
      productStreamModelProposalSchema.safeParse({ field, value: null, evidenceRef: null }).success,
      true,
    );
  }
  for (const [field, value] of [
    ["product.oe_numbers", "000-MOCK-OE"],
    ["specifications.kit_contents", ["clutch disc", "pressure plate"]],
    ["commercial.sample_available", "false"],
    ["commercial.moq", 1.5],
    ["specifications.clutch_diameter_mm", 0],
  ])
    assert.equal(
      productStreamModelProposalSchema.safeParse({ field, value, evidenceRef: "mock-ref" }).success,
      false,
    );
  const typedSource = prepareProductAgentEvidenceSource({
    record_id: "synthetic-typed-stream",
    source_ref: "source-synthetic-typed",
    evidence_refs: ["evidence-synthetic-typed"],
    source_text: "OE: 000-MOCK-OE\nKit contents: clutch disc, pressure plate\nSample available: no",
    image_availability: "none",
    image_refs: [],
  });
  let draft = emptyProductStreamDraft(typedSource);
  for (const [index, field, value] of [
    [0, "product.oe_numbers", ["000-MOCK-OE"]],
    [1, "specifications.kit_contents", ["clutch_disc", "pressure_plate"]],
    [2, "commercial.sample_available", false],
  ] as const) {
    const candidate = { field, value, evidenceRef: typedSource.evidence_locations[index]?.ref };
    assert.equal(productStreamModelProposalSchema.safeParse(candidate).success, true);
    const validated = validateProductStreamProposal(draft, candidate, typedSource);
    assert.equal(validated.status, "source_validated");
    if (validated.status === "source_validated") draft = validated.draft;
  }
  assert.deepEqual(draft.product.oe_numbers, ["000-MOCK-OE"]);
  assert.deepEqual(draft.specifications?.kit_contents, ["clutch_disc", "pressure_plate"]);
  assert.equal(draft.commercial?.sample_available, false);
  const unsupported = {
    field: "specifications.kit_contents",
    value: ["release_bearing"],
    evidenceRef: typedSource.evidence_locations[1]?.ref,
  };
  assert.equal(productStreamModelProposalSchema.safeParse(unsupported).success, true);
  assert.equal(
    validateProductStreamProposal(emptyProductStreamDraft(typedSource), unsupported, typedSource)
      .status,
    "invalid",
  );

  for (const withImage of [false, true])
    for (const truncated of [false, true]) {
      const imageBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==",
        "base64",
      );
      const testedSource = withImage
        ? {
            ...source,
            image_availability: "real_product_image" as const,
            image_refs: ["evidence-synthetic-image"],
            image_inputs: [
              {
                ref: "evidence-synthetic-image",
                media_type: "image/png" as const,
                data_base64: imageBytes.toString("base64"),
              },
            ],
          }
        : source;
      let output!: ReadableStreamDefaultController<Part>;
      const model = new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<Part>({
            start(controller) {
              output = controller;
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "text" });
              controller.enqueue({
                type: "text-delta",
                id: "text",
                delta: `{"elements":[${JSON.stringify(proposal)},{"field":`,
              });
            },
          }),
        }),
      });
      const iterator = streamProductProposals({
        model,
        source: testedSource,
        signal: AbortSignal.timeout(5000),
      });
      const first = await iterator.next();
      assert.deepEqual(first.value, proposal);
      assert.equal(first.done, false, "The first proposal must arrive before provider completion");
      output.enqueue({
        type: "text-delta",
        id: "text",
        delta: truncated
          ? '"product.product_type"'
          : JSON.stringify(nextProposal).slice('{"field":'.length) + "]}",
      });
      output.enqueue({ type: "text-end", id: "text" });
      output.enqueue(finish);
      output.close();
      if (truncated)
        await assert.rejects(async () => {
          for await (const _ of iterator) {
          }
        });
      else {
        assert.deepEqual((await iterator.next()).value, nextProposal);
        assert.equal((await iterator.next()).done, true);
      }
      const sentImages =
        model.doStreamCalls[0]?.prompt.flatMap((message) =>
          message.role === "user" ? message.content.filter((part) => part.type === "file") : [],
        ) ?? [];
      assert.equal(sentImages.length, withImage ? 1 : 0);
      if (withImage)
        assert.deepEqual(
          Buffer.from((sentImages[0]!.data as { type: "data"; data: Uint8Array }).data),
          imageBytes,
        );
      assert.equal(model.doStreamCalls.length, 1);
      const format = model.doStreamCalls[0]?.responseFormat;
      assert.equal(format?.type, "json");
      if (format?.type === "json") {
        const schema = JSON.stringify(format.schema);
        assert.ok(schema.includes('"anyOf"'));
        assert.ok(!schema.includes('"oneOf"'), "The saved provider rejects oneOf");
      }
    }
  console.log(
    "PASS actual AI SDK array parsing emits before completion and rejects truncated final output",
  );
}
void verify();
