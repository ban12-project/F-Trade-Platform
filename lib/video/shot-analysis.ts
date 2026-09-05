import { z } from "zod";

export const shotAnalysisVersion = "ffmpeg-scdet-frame-diff-v1";
export const shotDetectionFramesPerSecond = 4;
export const maximumDetectedShotIntervalMs = 12_000;

export const shotSourceAnalysisSchema = z
  .object({
    version: z.literal(shotAnalysisVersion),
    intervalStartMs: z.number().int().min(0),
    intervalEndMs: z.number().int().min(1_000),
    representativeMs: z.number().int().min(0),
    actionScore: z.number().int().min(0).max(100),
    actionLevel: z.enum(["low", "medium", "high"]),
    startBoundary: z.enum(["source", "scene", "window"]),
    endBoundary: z.enum(["scene", "window", "source"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.intervalEndMs - value.intervalStartMs < 1_000) {
      context.addIssue({
        code: "custom",
        path: ["intervalEndMs"],
        message: "检测镜头区间至少需要 1 秒。",
      });
    }
    if (
      value.representativeMs < value.intervalStartMs ||
      value.representativeMs >= value.intervalEndMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["representativeMs"],
        message: "代表帧必须位于检测镜头区间内。",
      });
    }
  });

export type ShotSourceAnalysis = z.infer<typeof shotSourceAnalysisSchema>;
type MotionSample = { timeMs: number; difference: number };

function finiteNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSceneCutMetadata(output: string, durationMs: number) {
  const cuts = [...output.matchAll(/lavfi\.scd\.time=([^\s]+)/g)]
    .map((match) => finiteNumber(match[1]))
    .filter((value): value is number => value !== null)
    .map((seconds) => Math.round(seconds * 1_000))
    .filter((timeMs) => timeMs >= 1_000 && timeMs <= durationMs - 1_000);
  return [...new Set(cuts)].sort((left, right) => left - right);
}

export function parseFrameDifferenceMetadata(output: string): MotionSample[] {
  const samples: MotionSample[] = [];
  let currentTimeSeconds: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    const time = line.match(/pts_time:([^\s]+)/);
    if (time) currentTimeSeconds = finiteNumber(time[1]);
    const value = line.match(/^lavfi\.signalstats\.YAVG=([^\s]+)/);
    if (!value || currentTimeSeconds === null) continue;
    const difference = finiteNumber(value[1]);
    if (difference !== null && currentTimeSeconds >= 0 && difference >= 0) {
      samples.push({ timeMs: Math.round(currentTimeSeconds * 1_000), difference });
    }
    currentTimeSeconds = null;
  }
  return samples.sort((left, right) => left.timeMs - right.timeMs);
}

function percentile(values: number[], proportion: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * proportion))]!;
}

function actionScore(value: number) {
  return Math.max(0, Math.min(100, Math.round((value / 32) * 100)));
}

function actionLevel(score: number): ShotSourceAnalysis["actionLevel"] {
  if (score < 25) return "low";
  if (score < 55) return "medium";
  return "high";
}

function splitBoundaries(durationMs: number, sceneCutsMs: number[]) {
  const scenes = [0, ...sceneCutsMs, durationMs];
  const boundaries: Array<{ timeMs: number; kind: "source" | "scene" | "window" }> = [
    { timeMs: 0, kind: "source" },
  ];
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const startMs = scenes[index]!;
    const endMs = scenes[index + 1]!;
    const parts = Math.max(1, Math.ceil((endMs - startMs) / maximumDetectedShotIntervalMs));
    for (let part = 1; part <= parts; part += 1) {
      const timeMs =
        part === parts ? endMs : Math.round(startMs + ((endMs - startMs) * part) / parts);
      boundaries.push({
        timeMs,
        kind: timeMs === durationMs ? "source" : part === parts ? "scene" : "window",
      });
    }
  }
  return boundaries;
}

export function detectShotIntervals(input: {
  durationMs: number;
  sceneMetadata: string;
  motionMetadata: string;
}) {
  if (!Number.isInteger(input.durationMs) || input.durationMs < 1_000)
    throw new Error("源视频不足 1 秒，不能检测镜头区间。");
  const sceneCuts = parseSceneCutMetadata(input.sceneMetadata, input.durationMs);
  const samples = parseFrameDifferenceMetadata(input.motionMetadata);
  const boundaries = splitBoundaries(input.durationMs, sceneCuts);
  return boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1]!;
    if (end.timeMs - start.timeMs < 1_000) return [];
    const inside = samples.filter(
      (sample) => sample.timeMs >= start.timeMs + 250 && sample.timeMs < end.timeMs - 250,
    );
    const usable = inside.length
      ? inside
      : samples.filter((sample) => sample.timeMs >= start.timeMs && sample.timeMs < end.timeMs);
    const typicalDifference = percentile(
      usable.map((sample) => sample.difference),
      0.75,
    );
    const score = actionScore(typicalDifference);
    const representativeTarget = percentile(
      usable.map((sample) => sample.difference),
      0.85,
    );
    const representative = usable.reduce<MotionSample | null>((best, sample) => {
      if (!best) return sample;
      return Math.abs(sample.difference - representativeTarget) <
        Math.abs(best.difference - representativeTarget)
        ? sample
        : best;
    }, null);
    return [
      shotSourceAnalysisSchema.parse({
        version: shotAnalysisVersion,
        intervalStartMs: start.timeMs,
        intervalEndMs: end.timeMs,
        representativeMs: representative?.timeMs ?? Math.floor((start.timeMs + end.timeMs) / 2),
        actionScore: score,
        actionLevel: actionLevel(score),
        startBoundary: start.kind,
        endBoundary: end.kind,
      }),
    ];
  });
}

export function selectDiverseActionIntervals(
  intervals: ShotSourceAnalysis[],
  maximumIntervals: number,
) {
  if (!Number.isInteger(maximumIntervals) || maximumIntervals < 1)
    throw new Error("候选镜头数量必须是正整数。");
  if (intervals.length <= maximumIntervals) return [...intervals];
  const ordered = [...intervals].sort(
    (left, right) =>
      right.actionScore - left.actionScore || left.intervalStartMs - right.intervalStartMs,
  );
  const totalDurationMs = Math.max(...intervals.map((interval) => interval.intervalEndMs));
  const minimumSeparationMs = Math.max(2_000, Math.floor(totalDurationMs / (maximumIntervals * 2)));
  const selected: ShotSourceAnalysis[] = [];
  for (const interval of ordered) {
    if (
      selected.every(
        (current) =>
          Math.abs(current.representativeMs - interval.representativeMs) >= minimumSeparationMs,
      )
    )
      selected.push(interval);
    if (selected.length === maximumIntervals) break;
  }
  for (const interval of ordered) {
    if (selected.length === maximumIntervals) break;
    if (!selected.includes(interval)) selected.push(interval);
  }
  return selected.sort((left, right) => left.intervalStartMs - right.intervalStartMs);
}

export function sceneDetectionFilter() {
  return `scale=320:-2,fps=${shotDetectionFramesPerSecond},scdet=t=8,metadata=print:key=lavfi.scd.time:file=-`;
}

export function frameDifferenceFilter() {
  return `scale=320:-2,fps=${shotDetectionFramesPerSecond},tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`;
}
