import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";
import { streamProductProposals } from "../lib/product/stream-model";

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
      assert.equal(model.doStreamCalls[0]?.responseFormat?.type, "json");
    }
  console.log(
    "PASS actual AI SDK array parsing emits before completion and rejects truncated final output",
  );
}
void verify();
