import { z } from "zod";

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1);
const bit = z.union([z.literal(0), z.literal(1)]);
const mode = z.enum(["text", "json", "json_schema"]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[a-zA-Z0-9/._-]+$/);
const policy = z.object({ mode, reason: identifier, version: z.literal("1") });
const manifestSchema = z.object({
  run_id: z.uuid(),
  protocol_version: z.literal("model-selection-v2"),
  execution: z.literal("local-production-policy"),
  source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  diagnostic_only: z.boolean(),
  grading: z.object({ diagnostic_revision: z.literal(2), verifier_sha256: digest }).optional(),
  execution_monitor: z
    .object({ max_event_loop_gap_ms: z.literal(5000), max_trial_duration_ms: z.literal(80000) })
    .optional(),
  started_at: z.iso.datetime(),
  concurrency: count.min(1).max(8),
  repetitions: z.literal(3),
  total_timeout_ms: z.literal(75000),
  max_corrections: z.literal(1),
  models: z.array(z.object({ name: identifier, id: identifier, output_policy: policy })).min(1),
  tasks: z
    .array(
      z.object({
        id: identifier,
        expectation_hash: digest,
        source_hash: digest,
        prompt_hash: digest,
        prompt_version: identifier,
      }),
    )
    .min(1),
});
const diagnosticSchema = z.object({
  json_object: bit,
  contract_valid: bit,
  expected_facts: count,
  predicted_facts: count,
  correct_facts: count,
  supported_correct_facts: count,
  fact_precision: rate,
  fact_recall: rate,
  evidence_recall: rate,
  model_blockers_exact: bit,
  model_state_boundary: bit,
});
const attemptSchema = z.object({
  number: count.min(1).max(2),
  outcome: z.enum(["accepted", "contract_or_source", "timeout", "provider", "runtime"]),
  duration_ms: z.number().nonnegative().nullable(),
  model_output_observed: z.boolean(),
  usage: z.object({
    input_tokens: count.nullable(),
    output_tokens: count.nullable(),
    total_tokens: count.nullable(),
  }),
  diagnostics: diagnosticSchema,
  strict_pass: bit,
});
const reportSchema = z.object({
  synthetic_id: identifier,
  diagnostic_revision: z.literal(2).optional(),
  protocol_version: z.literal("model-selection-v2"),
  prompt_version: identifier,
  prompt_hash: digest,
  expectation_hash: digest,
  evidence_mode: z.literal("bounded_location"),
  provenance_valid: z.literal(true),
  output_mode: mode,
  reward: bit,
  first_attempt_pass: bit,
  final_accepted: z.boolean(),
  duration_ms: z.number().nonnegative().nullable(),
  attempts: z.array(attemptSchema).min(1).max(2),
});
const preflightSchema = z.array(
  z.object({
    model: identifier,
    available: z.boolean(),
    image_correct: z.boolean(),
    output_mode: mode,
  }),
);
const reportsSchema = z.array(
  z.object({
    model: identifier,
    id: identifier,
    repetition: count.min(1).max(3),
    report: reportSchema,
  }),
);
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw new Error("Duplicate evaluation identity");
}

/** Strip unknown fields at every level. No response text, error or endpoint is publishable. */
export function summarizeSelection(
  manifestInput: unknown,
  preflightInput: unknown,
  reportsInput: unknown,
) {
  const manifest = manifestSchema.parse(manifestInput);
  const preflights = preflightSchema.parse(preflightInput);
  const reports = reportsSchema.parse(reportsInput);
  unique(manifest.models.map((m) => m.name));
  unique(manifest.tasks.map((t) => t.id));
  unique(preflights.map((p) => p.model));
  unique(reports.map((r) => `${r.model}/${r.id}/${r.repetition}`));
  if (preflights.length !== manifest.models.length) throw new Error("Missing capability preflight");
  for (const p of preflights) {
    const model = manifest.models.find((m) => m.name === p.model);
    if (!model || p.output_mode !== model.output_policy.mode || (!p.available && p.image_correct))
      throw new Error("Invalid capability provenance");
  }
  for (const entry of reports) {
    const task = manifest.tasks.find((t) => t.id === entry.id);
    const model = manifest.models.find((m) => m.name === entry.model);
    const report = entry.report;
    if (manifest.grading && report.diagnostic_revision !== manifest.grading.diagnostic_revision)
      throw new Error("Mixed diagnostic revisions");
    if (
      !task ||
      !model ||
      !preflights.find((p) => p.model === entry.model)?.available ||
      report.synthetic_id !== task.id ||
      report.output_mode !== model.output_policy.mode ||
      report.prompt_version !== task.prompt_version ||
      report.prompt_hash !== task.prompt_hash ||
      report.expectation_hash !== task.expectation_hash
    )
      throw new Error("Report provenance mismatch");
    const first = report.attempts[0];
    const last = report.attempts.at(-1);
    if (
      !first ||
      !last ||
      report.first_attempt_pass !== first.strict_pass ||
      report.reward !== last.strict_pass ||
      report.final_accepted !== (last.outcome === "accepted") ||
      report.attempts.some(
        (a, i) => a.number !== i + 1 || (a.strict_pass === 1 && a.outcome !== "accepted"),
      ) ||
      (report.attempts.length === 2 && first.outcome !== "contract_or_source")
    )
      throw new Error("Inconsistent attempt provenance");
  }
  const models = manifest.models.map((model) => {
    const preflight = preflights.find((p) => p.model === model.name);
    const trials = reports.filter((r) => r.model === model.name).map((r) => r.report);
    const expected = manifest.tasks.length * manifest.repetitions;
    const attempts = trials.flatMap((t) => t.attempts);
    const observed = attempts.filter((a) => a.model_output_observed);
    const first = trials.flatMap((t) => t.attempts.slice(0, 1));
    const final = trials.flatMap((t) => t.attempts.slice(-1));
    const durations = trials.flatMap((t) => (t.duration_ms === null ? [] : [t.duration_ms]));
    const passed = trials.reduce((n, t) => n + t.reward, 0);
    const firstPassed = trials.reduce((n, t) => n + t.first_attempt_pass, 0);
    const firstFailures = trials.length - firstPassed;
    const diagnostics = (list: typeof attempts) =>
      Object.fromEntries(
        (
          [
            "json_object",
            "contract_valid",
            "fact_precision",
            "fact_recall",
            "evidence_recall",
            "model_blockers_exact",
            "model_state_boundary",
          ] as const
        ).map((key) => [key, mean(list.map((a) => a.diagnostics[key]))]),
      );
    const knownTokens = Object.fromEntries(
      (["input_tokens", "output_tokens", "total_tokens"] as const).map((key) => [
        key,
        {
          observed_sum: attempts.reduce((sum, a) => sum + (a.usage[key] ?? 0), 0),
          missing_attempts: attempts.filter((a) => a.usage[key] === null).length,
        },
      ]),
    );
    return {
      name: model.name,
      id: model.id,
      output_policy: model.output_policy,
      preflight,
      status: !preflight?.available
        ? "unavailable"
        : trials.length === expected
          ? "completed"
          : "incomplete",
      expected_trials: preflight?.available ? expected : 0,
      completed_trials: trials.length,
      first_passed: firstPassed,
      final_passed: passed,
      first_pass_rate: mean(trials.map((t) => t.first_attempt_pass)),
      final_pass_rate: mean(trials.map((t) => t.reward)),
      strict_gate: trials.length === expected && passed === expected,
      correction_trials: trials.filter((t) => t.attempts.length === 2).length,
      recovered_trials: trials.filter((t) => !t.first_attempt_pass && t.reward).length,
      recovery_rate: firstFailures
        ? trials.filter((t) => !t.first_attempt_pass && t.reward).length / firstFailures
        : null,
      first_response_metrics: diagnostics(first),
      final_response_metrics: diagnostics(final),
      observed_response_count: observed.length,
      attempt_count: attempts.length,
      final_outcomes: Object.fromEntries(
        ["accepted", "contract_or_source", "timeout", "provider", "runtime"].map((key) => [
          key,
          final.filter((a) => a.outcome === key).length,
        ]),
      ),
      latency_ms: {
        p50: percentile(durations, 0.5),
        p90: percentile(durations, 0.9),
        missing_trials: trials.length - durations.length,
      },
      successful_latency_ms: {
        p50: percentile(
          trials.flatMap((t) => (t.reward && t.duration_ms !== null ? [t.duration_ms] : [])),
          0.5,
        ),
      },
      usage: knownTokens,
      billed_cost: null,
      cost_reason: "No verified endpoint billing data",
    };
  });
  return {
    ...manifest,
    scope: "synthetic-product-agent-model-selection",
    status: models.some((m) => m.status === "incomplete")
      ? "incomplete"
      : models.every((m) => m.status === "unavailable")
        ? "unavailable"
        : "completed",
    models,
    trials: reports,
  };
}
