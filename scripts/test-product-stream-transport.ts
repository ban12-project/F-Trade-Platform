import assert from "node:assert/strict";
import { consumeProductStream } from "../lib/product/stream-client";
import type { ProductStreamEvent } from "../lib/product/stream-contract";
import { productStreamResponse, readProductStreamForm } from "../lib/product/stream-response";

const event: ProductStreamEvent = {
  protocol: "product-agent.v1",
  runId: "00000000-0000-4000-8000-000000000117",
  sequence: 1,
  type: "stage",
  stage: "completed",
};
async function verify() {
  let cleanup = 0;
  const controller = new AbortController();
  async function* waiting(): AsyncGenerator<ProductStreamEvent> {
    try {
      yield { ...event, type: "stage", stage: "generating" };
      await new Promise<void>((resolve) =>
        controller.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    } finally {
      cleanup++;
    }
  }
  let cancelled = 0;
  const response = productStreamResponse(waiting(), controller, async () => {
    cancelled++;
  });
  assert.ok(response.body);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /generating/);
  await reader.cancel();
  assert.equal(controller.signal.aborted, true);
  assert.equal(cleanup, 1);
  assert.equal(cancelled, 1);

  // Cancellation before the generator's first statement still closes the durable run.
  let earlyCleanup = 0;
  const early = productStreamResponse(waiting(), new AbortController(), async () => {
    earlyCleanup++;
  });
  assert.ok(early.body);
  await early.body.cancel();
  assert.equal(earlyCleanup, 1);

  for (const bad of [false, true]) {
    const bytes = new TextEncoder().encode(
      `${JSON.stringify({ ...event, sequence: bad ? 2 : 1 })}\n`,
    );
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        for (const byte of bytes) output.enqueue(new Uint8Array([byte]));
        output.close();
      },
    });
    const received: ProductStreamEvent[] = [];
    const consume = () => consumeProductStream(body, (value) => received.push(value));
    if (bad) await assert.rejects(consume, /事件顺序/);
    else {
      await consume();
      assert.deepEqual(received, [event]);
    }
  }
  await assert.rejects(
    () =>
      consumeProductStream(
        new ReadableStream({
          start(output) {
            output.close();
          },
        }),
        () => {},
      ),
    /连接已中断/,
  );
  const form = new FormData();
  form.set("sourceText", "synthetic 中文");
  const request = new Request("https://example.invalid", { method: "POST", body: form });
  assert.equal((await readProductStreamForm(request)).get("sourceText"), "synthetic 中文");
  await assert.rejects(
    () =>
      readProductStreamForm(
        new Request("https://example.invalid", {
          method: "POST",
          body: "sourceText=too-long",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }),
        5,
      ),
    /大小限制/,
  );
  console.log(
    "PASS transport cancellation, early cleanup, chunk parsing, sequence validation and bounded form input",
  );
}
void verify();
