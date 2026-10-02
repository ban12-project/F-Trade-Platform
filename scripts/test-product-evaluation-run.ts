import assert from "node:assert/strict";
import { productAgentEvalCases } from "../evals/harbor/product-agent/cases";
import type { ProductAgentResult } from "../lib/product/agent";
import { runProductAgentEvaluation } from "../lib/product/evaluation-run";

async function main() {
  const item = productAgentEvalCases[0];
  assert.ok(item);
  const request = { source: item.source, model: {} as never };
  const output = { draft: { record_id: "synthetic" }, metadata: {} } as ProductAgentResult;
  let calls = 0;
  const corrected = await runProductAgentEvaluation(request, {
    async run(input) {
      calls++;
      assert.ok(input.timeout_ms !== undefined && input.timeout_ms <= 75000);
      input.observe_model_response?.({
        text: "synthetic output",
        duration_ms: 1,
        output_mode: "text",
      });
      if (!input.repair_invalid_output) throw new Error("Contract validation failed: synthetic");
      return output;
    },
  });
  assert.equal(calls, 2);
  assert.equal(corrected._evaluation.first_attempt_accepted, false);
  assert.equal(corrected._evaluation.final_accepted, true);
  assert.equal(corrected._diagnostics.attempts[0]?.outcome, "contract_or_source");
  assert.equal(corrected._diagnostics.attempts[0]?.responses[0]?.text, "synthetic output");
  assert.equal(corrected._diagnostics.attempts[1]?.correction, true);
  const rejected = await runProductAgentEvaluation(request, {
    async run() {
      throw new Error("Product Agent unsupported source");
    },
  });
  assert.equal(rejected._evaluation.attempt_count, 2);
  assert.equal(rejected.draft, null);
  const unavailable = await runProductAgentEvaluation(request, {
    async run() {
      throw Object.assign(new Error("private provider detail"), { statusCode: 401 });
    },
  });
  assert.equal(unavailable._evaluation.failure, "provider");
  assert.equal(unavailable._evaluation.attempt_count, 1);
  assert.ok(!JSON.stringify(unavailable._evaluation).includes("private provider detail"));
  console.log(
    "PASS production policy, first/final attempts, rejected raw diagnostics, provider failures and safe summary",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
