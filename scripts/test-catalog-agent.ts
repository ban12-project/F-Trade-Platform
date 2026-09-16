import assert from "node:assert/strict";
import type { ProductAgentRequest, ProductAgentResult } from "../lib/product/agent";
import { runCatalogProductAgent } from "../lib/product/catalog-agent";

// Synthetic adapter: tests retry policy, never a claim about model extraction quality.
const request = { timeout_ms: 75_000 } as ProductAgentRequest;
const result = {
  metadata: { prompt_version: "synthetic", prompt_hash: "synthetic" },
} as ProductAgentResult;
void (async () => {
  const calls: ProductAgentRequest[] = [];
  let time = 0;
  assert.equal(
    await runCatalogProductAgent(
      request,
      {
        run: async (input) => {
          calls.push(input);
          if (calls.length === 1) {
            time = 12_000;
            throw new Error("Product Agent must provide evidence for exactly its populated facts");
          }
          return result;
        },
      },
      () => time,
    ),
    result,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.repair_invalid_output, true);
  assert.equal(calls[1]?.timeout_ms, 63_000);
  for (const failure of [
    new Error("Provider unavailable"),
    new Error("Product Agent invalid output"),
  ]) {
    let count = 0;
    await assert.rejects(
      runCatalogProductAgent(request, {
        run: async () => {
          count++;
          throw failure;
        },
      }),
      (error) => error === failure,
    );
    assert.equal(count, failure.message.startsWith("Product Agent") ? 2 : 1);
  }
  time = 0;
  let count = 0;
  await assert.rejects(
    runCatalogProductAgent(
      request,
      {
        run: async () => {
          count++;
          time = 75_000;
          throw new Error("Contract validation failed: synthetic");
        },
      },
      () => time,
    ),
  );
  assert.equal(count, 1, "no retry beyond the total deadline");
  console.log(
    "PASS: catalog correction is limited to one validated retry within the original deadline; provider failures are not blindly repeated",
  );
})();
