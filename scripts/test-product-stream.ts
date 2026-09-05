import assert from "node:assert/strict";
import type { ProductAgentSource } from "../lib/product/agent";
import { type ProductStreamEvent, productStreamEventSchema } from "../lib/product/stream-contract";
import { runProductStream } from "../lib/product/stream-runner";
import type { ProductDraft } from "../lib/product/verification";

const source: ProductAgentSource = {
  record_id: "00000000-0000-4000-8000-000000000117",
  source_ref: "source-synthetic-stream",
  evidence_refs: ["evidence-synthetic-stream"],
  source_text:
    "Product name: Synthetic clutch\nProduct type: clutch_disc\nPart No.: SYN-117\nOE: OE-SYN-117",
  image_availability: "none",
  image_refs: [],
};
const runId = "00000000-0000-4000-8000-000000000118";

async function verify() {
  const saved: ProductDraft[] = [];
  const terminal: string[] = [];
  const events: ProductStreamEvent[] = [];
  let firstWasCommitted = false;
  const stream = runProductStream({
    runId,
    source,
    signal: new AbortController().signal,
    async *proposals(located) {
      const ref = located.evidence_locations.find((location) =>
        location.text.includes("Product name:"),
      )?.ref;
      assert.ok(ref);
      yield { field: "product.product_name", value: "Synthetic clutch", evidenceRef: ref };
      // Execution only advances after the first accepted field was durably acknowledged.
      assert.equal(saved.length, 1);
      assert.ok(events.some((event) => event.type === "draft"));
      firstWasCommitted = true;
      yield { field: "product.internal_sku", value: "SYN-117", evidenceRef: null };
      yield { field: "product.oe_numbers", value: ["FAKE-OE"], evidenceRef: ref };
      yield { field: "product.product_name", value: "Replacement", evidenceRef: ref };
      throw new Error("synthetic model disconnect");
    },
    async persist(draft) {
      saved.push(draft);
      return { productId: source.record_id, version: saved.length };
    },
    async finish(status) {
      terminal.push(status);
    },
  });
  for await (const event of stream) events.push(productStreamEventSchema.parse(event));
  assert.equal(firstWasCommitted, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.verification_status, "review_required");
  assert.equal(saved[0]?.product.product_name, "Synthetic clutch");
  assert.equal(saved[0]?.product.oe_numbers, undefined);
  assert.deepEqual(terminal, ["failed"]);
  assert.ok(events.some((event) => event.type === "field" && event.status === "needs_evidence"));
  assert.equal(
    events.filter((event) => event.type === "field" && event.status === "invalid").length,
    2,
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index + 1),
  );

  for (const scenario of ["success", "abort", "cancel", "revoked"] as const) {
    const controller = new AbortController();
    let writes = 0;
    const outcomes: string[] = [];
    const iterator = runProductStream({
      runId,
      source,
      signal: controller.signal,
      async *proposals(located) {
        yield {
          field: "product.product_name",
          value: "Synthetic clutch",
          evidenceRef: located.evidence_locations[0]?.ref,
        };
        if (scenario === "abort") controller.abort();
        yield {
          field: "product.product_type",
          value: "clutch_disc",
          evidenceRef: located.evidence_locations[1]?.ref,
        };
      },
      async persist() {
        if (scenario === "revoked" && writes === 1) throw new Error("synthetic role revocation");
        return { productId: source.record_id, version: ++writes };
      },
      async finish(status) {
        outcomes.push(status);
      },
    });
    for await (const event of iterator) {
      if (scenario === "cancel" && event.type === "draft") break;
    }
    assert.equal(writes, scenario === "success" ? 2 : 1);
    assert.deepEqual(outcomes, [
      scenario === "success" ? "completed" : scenario === "revoked" ? "failed" : "interrupted",
    ]);
  }
  console.log(
    "PASS incremental fields persist before completion; invalid evidence, failures, cancellation and revoked writes preserve review-only drafts",
  );
}
void verify();
