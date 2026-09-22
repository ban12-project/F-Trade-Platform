import assert from "node:assert/strict";
import { summarizeSelection } from "../evals/harbor/product-agent/selection-summary";

const h = "a".repeat(64);
const manifest = {
  run_id: "a91e5682-72e8-4568-b103-5b1660b89a9a",
  protocol_version: "model-selection-v2",
  execution: "local-production-policy",
  source_commit: "b".repeat(40),
  diagnostic_only: false,
  started_at: "2026-09-22T00:00:00Z",
  concurrency: 4,
  repetitions: 3,
  total_timeout_ms: 75000,
  max_corrections: 1,
  models: [
    {
      name: "model",
      id: "openai/synthetic",
      output_policy: { mode: "json_schema", reason: "native_provider", version: "1" },
    },
  ],
  tasks: [
    { id: "a-01", expectation_hash: h, source_hash: h, prompt_hash: h, prompt_version: "1.1.0" },
  ],
};
const preflights = [
  { model: "model", available: true, image_correct: true, output_mode: "json_schema" },
];
const report = {
  synthetic_id: "a-01",
  protocol_version: "model-selection-v2",
  prompt_version: "1.1.0",
  prompt_hash: h,
  expectation_hash: h,
  evidence_mode: "bounded_location",
  provenance_valid: true,
  output_mode: "json_schema",
  reward: 0,
  first_attempt_pass: 0,
  final_accepted: false,
  duration_ms: 75000,
  private_output: "must-not-escape",
  attempts: [
    {
      number: 1,
      outcome: "timeout",
      duration_ms: 75000,
      model_output_observed: false,
      usage: { input_tokens: null, output_tokens: null, total_tokens: null },
      error: "must-not-escape",
      diagnostics: {
        json_object: 0,
        contract_valid: 0,
        expected_facts: 2,
        predicted_facts: 0,
        correct_facts: 0,
        supported_correct_facts: 0,
        fact_precision: 0,
        fact_recall: 0,
        evidence_recall: 0,
        model_blockers_exact: 0,
        model_state_boundary: 0,
      },
      strict_pass: 0,
    },
  ],
};
const reports = [1, 2, 3].map((repetition) => ({ model: "model", id: "a-01", repetition, report }));
const summary = summarizeSelection(manifest, preflights, reports);
assert.equal(summary.status, "completed", "Low quality is a completed measurement");
assert.equal(summary.models[0].strict_gate, false);
assert.equal(summary.models[0].final_pass_rate, 0);
assert.equal(summary.models[0].billed_cost, null);
assert.deepEqual(summary.models[0].usage.total_tokens, { observed_sum: 0, missing_attempts: 3 });
assert.equal(JSON.stringify(summary).includes("must-not-escape"), false);
assert.equal(summarizeSelection(manifest, preflights, reports.slice(1)).status, "incomplete");
assert.throws(() => summarizeSelection(manifest, preflights, [...reports, reports[0]]));
assert.throws(() =>
  summarizeSelection(manifest, preflights, [
    { ...reports[0], report: { ...report, prompt_hash: "c".repeat(64) } },
  ]),
);
assert.throws(() =>
  summarizeSelection(manifest, preflights, [{ ...reports[0], report: { ...report, reward: 1 } }]),
);
assert.throws(() =>
  summarizeSelection({ ...manifest, total_timeout_ms: 190000 }, preflights, reports),
);
const unavailable = [{ ...preflights[0], available: false, image_correct: false }];
assert.equal(summarizeSelection(manifest, unavailable, []).status, "unavailable");
assert.equal(summarizeSelection(manifest, unavailable, []).models[0].final_pass_rate, null);
assert.throws(() => summarizeSelection(manifest, unavailable, reports));
console.log(
  "PASS selection summary: completeness, provenance, private data, unknown billing and availability",
);
