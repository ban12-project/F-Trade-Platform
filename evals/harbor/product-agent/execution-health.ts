/** A suspended workstation must not turn infrastructure stalls into model latency. */
export const SELECTION_EXECUTION_MONITOR = {
  max_event_loop_gap_ms: 5_000,
  // 75-second request budget plus bounded abort/cleanup scheduling allowance.
  max_trial_duration_ms: 80_000,
} as const;

export class SelectionExecutionClock {
  private last: number;
  private maxGap = 0;
  private clockReversed = false;
  constructor(startedAt: number) {
    this.last = startedAt;
  }
  observe(now: number) {
    const gap = now - this.last;
    this.clockReversed ||= gap < 0;
    this.maxGap = Math.max(this.maxGap, gap);
    this.last = now;
  }
  assess(durations: Array<number | null>) {
    const invalidDurations = durations.filter(
      (value) =>
        value === null ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > SELECTION_EXECUTION_MONITOR.max_trial_duration_ms,
    ).length;
    return {
      valid:
        !this.clockReversed &&
        this.maxGap <= SELECTION_EXECUTION_MONITOR.max_event_loop_gap_ms &&
        invalidDurations === 0,
      max_event_loop_gap_ms: this.maxGap,
      clock_reversed: this.clockReversed,
      invalid_duration_trials: invalidDurations,
    };
  }
}
