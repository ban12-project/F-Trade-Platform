import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { SELECTION_EXECUTION_MONITOR, SelectionExecutionClock } from "./execution-health";
import { summarizeSelection } from "./selection-summary";

const publicationSchema = z.object({
  status: z.literal("completed"),
  diagnostic_only: z.literal(false),
  measurement_valid: z.literal(true),
  infrastructure_failed: z.literal(false),
  finished_at: z.iso.datetime(),
  execution_monitor: z
    .object({
      max_event_loop_gap_ms: z.literal(SELECTION_EXECUTION_MONITOR.max_event_loop_gap_ms),
      max_trial_duration_ms: z.literal(SELECTION_EXECUTION_MONITOR.max_trial_duration_ms),
    })
    .strict(),
  grading: z
    .object({
      diagnostic_revision: z.literal(2),
      verifier_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  execution_health: z
    .object({
      valid: z.literal(true),
      max_event_loop_gap_ms: z.number().nonnegative(),
      clock_reversed: z.literal(false),
      invalid_duration_trials: z.literal(0),
    })
    .strict(),
  models: z.array(z.object({ preflight: z.unknown() })),
  trials: z.array(z.unknown()),
});

/** Verify published totals from trial records and reject any non-allowlisted content. */
export function validateSelectionReport(value: unknown) {
  const publication = publicationSchema.parse(value);
  const recomputed = summarizeSelection(
    value,
    publication.models.map((m) => m.preflight),
    publication.trials,
  );
  if (Date.parse(publication.finished_at) < Date.parse(recomputed.started_at))
    throw new Error("Report finished before it started");
  const clock = new SelectionExecutionClock(0);
  clock.observe(publication.execution_health.max_event_loop_gap_ms);
  const health = clock.assess(recomputed.trials.map((t) => t.report.duration_ms));
  if (!health.valid || !isDeepStrictEqual(health, publication.execution_health))
    throw new Error("Invalid measurement health");
  const verified = {
    ...recomputed,
    status: recomputed.status,
    measurement_valid: true,
    execution_health: health,
    finished_at: publication.finished_at,
    infrastructure_failed: false,
  };
  if (!isDeepStrictEqual(value, verified))
    throw new Error("Report differs from allowlisted trial-derived totals");
  return verified;
}
