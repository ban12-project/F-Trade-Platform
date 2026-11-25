import { z } from "zod";

export const shotAnalysisVersion = "ffmpeg-scdet-signalstats-v2";
export const legacyShotAnalysisVersion = "ffmpeg-scdet-frame-diff-v1";
export const shotDetectionFramesPerSecond = 4;
export const maximumDetectedShotIntervalMs = 12_000;

const baseShotSourceAnalysisShape = {
  intervalStartMs: z.number().int().min(0),
  intervalEndMs: z.number().int().min(1_000),
  representativeMs: z.number().int().min(0),
  actionScore: z.number().int().min(0).max(100),
  actionLevel: z.enum(["low", "medium", "high"]),
  startBoundary: z.enum(["source", "scene", "window"]),
  endBoundary: z.enum(["scene", "window", "source"]),
} as const;

const legacyShotSourceAnalysisSchema = z
  .object({
    version: z.literal(legacyShotAnalysisVersion),
    ...baseShotSourceAnalysisShape,
  })
  .strict();

export const signalStatsShotSourceAnalysisSchema = z
  .object({
    version: z.literal(shotAnalysisVersion),
    ...baseShotSourceAnalysisShape,
    brightnessScore: z.number().int().min(0).max(100),
    brightnessLevel: z.enum(["low", "medium", "high"]),
    contrastScore: z.number().int().min(0).max(100),
    contrastLevel: z.enum(["low", "medium", "high"]),
  })
  .strict();

export const shotSourceAnalysisSchema = z
  .discriminatedUnion("version", [
    signalStatsShotSourceAnalysisSchema,
    legacyShotSourceAnalysisSchema,
  ])
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
export type VisualSignalSample = { timeMs: number; luma: number; contrast: number };

function finiteNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
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

export function parseVisualSignalMetadata(output: string): VisualSignalSample[] {
  const samples: VisualSignalSample[] = [];
  let currentTimeSeconds: number | null = null;
  let frameStats: {
    yavg?: number;
    ylow?: number;
    yhigh?: number;
    ymin?: number;
    ymax?: number;
  } = {};

  function flushFrame() {
    if (currentTimeSeconds === null || currentTimeSeconds < 0 || frameStats.yavg === undefined) {
      frameStats = {};
      return;
    }
    const contrast =
      frameStats.yhigh !== undefined && frameStats.ylow !== undefined
        ? Math.max(0, frameStats.yhigh - frameStats.ylow)
        : frameStats.ymax !== undefined && frameStats.ymin !== undefined
          ? Math.max(0, frameStats.ymax - frameStats.ymin)
          : 0;
    samples.push({
      timeMs: Math.round(currentTimeSeconds * 1_000),
      luma: frameStats.yavg,
      contrast,
    });
    frameStats = {};
  }

  for (const line of output.split(/\r?\n/)) {
    const time = line.match(/pts_time:([^\s]+)/);
    if (time) {
      flushFrame();
      currentTimeSeconds = finiteNumber(time[1]);
      continue;
    }
    const match = line.match(/^lavfi\.signalstats\.(YAVG|YLOW|YHIGH|YMIN|YMAX)=([^\s]+)/);
    if (!match || currentTimeSeconds === null) continue;
    const parsed = finiteNumber(match[2]);
    if (parsed === null || parsed < 0) continue;
    if (match[1] === "YAVG") frameStats.yavg = parsed;
    else if (match[1] === "YLOW") frameStats.ylow = parsed;
    else if (match[1] === "YHIGH") frameStats.yhigh = parsed;
    else if (match[1] === "YMIN") frameStats.ymin = parsed;
    else if (match[1] === "YMAX") frameStats.ymax = parsed;
  }
  flushFrame();
  return samples.sort((left, right) => left.timeMs - right.timeMs);
}

function percentile(values: number[], proportion: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * proportion))];
}

function actionScore(value: number) {
  return clampScore((value / 32) * 100);
}

function actionLevel(score: number): ShotSourceAnalysis["actionLevel"] {
  if (score < 25) return "low";
  if (score < 55) return "medium";
  return "high";
}

function brightnessLevel(score: number): "low" | "medium" | "high" {
  if (score < 32) return "low";
  if (score < 60) return "medium";
  return "high";
}

function contrastLevel(score: number): "low" | "medium" | "high" {
  if (score < 28) return "low";
  if (score < 60) return "medium";
  return "high";
}

function splitBoundaries(durationMs: number, sceneCutsMs: number[]) {
  const scenes = [0, ...sceneCutsMs, durationMs];
  const boundaries: Array<{ timeMs: number; kind: "source" | "scene" | "window" }> = [
    { timeMs: 0, kind: "source" },
  ];
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const startMs = scenes[index];
    const endMs = scenes[index + 1];
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
  visualMetadata?: string;
}) {
  if (!Number.isInteger(input.durationMs) || input.durationMs < 1_000)
    throw new Error("源视频不足 1 秒，不能检测镜头区间。");
  const sceneCuts = parseSceneCutMetadata(input.sceneMetadata, input.durationMs);
  const samples = parseFrameDifferenceMetadata(input.motionMetadata);
  const visualSamples = parseVisualSignalMetadata(input.visualMetadata ?? input.sceneMetadata);
  const boundaries = splitBoundaries(input.durationMs, sceneCuts);
  return boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1];
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
    const visualInside = visualSamples.filter(
      (sample) => sample.timeMs >= start.timeMs && sample.timeMs < end.timeMs,
    );
    const brightnessScore = visualInside.length
      ? clampScore(
          (percentile(
            visualInside.map((sample) => sample.luma),
            0.5,
          ) /
            255) *
            100,
        )
      : 50;
    const contrastScore = visualInside.length
      ? clampScore(
          (percentile(
            visualInside.map((sample) => sample.contrast),
            0.5,
          ) /
            140) *
            100,
        )
      : 50;
    const parsed = shotSourceAnalysisSchema.parse({
      version: shotAnalysisVersion,
      intervalStartMs: start.timeMs,
      intervalEndMs: end.timeMs,
      representativeMs: representative?.timeMs ?? Math.floor((start.timeMs + end.timeMs) / 2),
      actionScore: score,
      actionLevel: actionLevel(score),
      brightnessScore,
      brightnessLevel: brightnessLevel(brightnessScore),
      contrastScore,
      contrastLevel: contrastLevel(contrastScore),
      startBoundary: start.kind,
      endBoundary: end.kind,
    });
    return [signalStatsShotSourceAnalysisSchema.parse(parsed)];
  });
}

function intervalSelectionScore(interval: ShotSourceAnalysis) {
  const brightness = "brightnessScore" in interval ? interval.brightnessScore : 50;
  const contrast = "contrastScore" in interval ? interval.contrastScore : 50;
  const bLevel = "brightnessLevel" in interval ? interval.brightnessLevel : "medium";
  const cLevel = "contrastLevel" in interval ? interval.contrastLevel : "medium";
  return (
    interval.actionScore * 0.55 +
    brightness * 0.22 +
    contrast * 0.23 -
    (bLevel === "low" ? 20 : 0) -
    (cLevel === "low" ? 20 : 0)
  );
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
      intervalSelectionScore(right) - intervalSelectionScore(left) ||
      right.actionScore - left.actionScore ||
      left.intervalStartMs - right.intervalStartMs,
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
  return `scale=320:-2,fps=${shotDetectionFramesPerSecond},signalstats,scdet=t=8,metadata=print:file=-`;
}

export function frameDifferenceFilter() {
  return `scale=320:-2,fps=${shotDetectionFramesPerSecond},tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`;
}
