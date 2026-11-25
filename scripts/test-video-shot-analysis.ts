import assert from "node:assert/strict";

import {
  detectShotIntervals,
  legacyShotAnalysisVersion,
  parseFrameDifferenceMetadata,
  parseSceneCutMetadata,
  parseVisualSignalMetadata,
  selectDiverseActionIntervals,
  shotAnalysisVersion,
  shotSourceAnalysisSchema,
} from "../lib/video/shot-analysis";

const sceneMetadata = [
  "frame:8 pts:2 pts_time:2",
  "lavfi.scd.time=2",
  "lavfi.scd.time=bad",
  "lavfi.scd.time=7.5",
].join("\n");
assert.deepEqual(parseSceneCutMetadata(sceneMetadata, 10_000), [2_000, 7_500]);

const motionMetadata = [
  "frame:1 pts:0 pts_time:0.25",
  "lavfi.signalstats.YAVG=2",
  "frame:2 pts:0 pts_time:1.25",
  "lavfi.signalstats.YAVG=4",
  "frame:3 pts:0 pts_time:2.25",
  "lavfi.signalstats.YAVG=25",
  "frame:4 pts:0 pts_time:3.25",
  "lavfi.signalstats.YAVG=30",
  "frame:5 pts:0 pts_time:7.75",
  "lavfi.signalstats.YAVG=12",
  "frame:bad pts_time:nope",
  "lavfi.signalstats.YAVG=bad",
].join("\n");
assert.deepEqual(
  parseFrameDifferenceMetadata(motionMetadata).map(({ timeMs, difference }) => ({
    timeMs,
    difference,
  })),
  [
    { timeMs: 250, difference: 2 },
    { timeMs: 1_250, difference: 4 },
    { timeMs: 2_250, difference: 25 },
    { timeMs: 3_250, difference: 30 },
    { timeMs: 7_750, difference: 12 },
  ],
);

const intervals = detectShotIntervals({ durationMs: 30_000, sceneMetadata, motionMetadata });
assert.ok(intervals.length >= 4);
assert.ok(
  intervals.every((interval) => interval.intervalEndMs - interval.intervalStartMs <= 12_000),
);
assert.ok(
  intervals.every(
    (interval) =>
      interval.representativeMs >= interval.intervalStartMs &&
      interval.representativeMs < interval.intervalEndMs,
  ),
);
assert.ok(
  intervals.some((interval) => interval.actionScore >= 75 && interval.actionLevel === "high"),
);
assert.equal(intervals[0]?.startBoundary, "source");
assert.equal(intervals.at(-1)?.endBoundary, "source");

const selected = selectDiverseActionIntervals(intervals, 3);
assert.equal(selected.length, 3);
assert.deepEqual(
  selected,
  [...selected].sort((left, right) => left.intervalStartMs - right.intervalStartMs),
);
assert.throws(() => selectDiverseActionIntervals(intervals, 0), /正整数/);
assert.throws(
  () => detectShotIntervals({ durationMs: 999, sceneMetadata: "", motionMetadata: "" }),
  /不足 1 秒/,
);

const visualMetadata = [
  "frame:1 pts:0 pts_time:0.5",
  "lavfi.signalstats.YMIN=10",
  "lavfi.signalstats.YLOW=15",
  "lavfi.signalstats.YAVG=30",
  "lavfi.signalstats.YHIGH=35",
  "lavfi.signalstats.YMAX=45",
  "lavfi.scd.time=4.0",
  "frame:2 pts:0 pts_time:5.0",
  "lavfi.signalstats.YMIN=25",
  "lavfi.signalstats.YLOW=45",
  "lavfi.signalstats.YAVG=180",
  "lavfi.signalstats.YHIGH=205",
  "lavfi.signalstats.YMAX=240",
  "frame:bad pts_time:nope",
  "lavfi.signalstats.YAVG=bad",
].join("\n");
const parsedVisual = parseVisualSignalMetadata(visualMetadata);
assert.deepEqual(parsedVisual, [
  { timeMs: 500, luma: 30, contrast: 20 },
  { timeMs: 5_000, luma: 180, contrast: 160 },
]);

const scoredIntervals = detectShotIntervals({
  durationMs: 10_000,
  sceneMetadata: visualMetadata,
  motionMetadata: [
    "frame:1 pts:0 pts_time:1.0",
    "lavfi.signalstats.YAVG=16",
    "frame:2 pts:0 pts_time:6.0",
    "lavfi.signalstats.YAVG=16",
  ].join("\n"),
});
assert.equal(scoredIntervals.length, 2);
assert.equal(scoredIntervals[0]?.version, shotAnalysisVersion);
assert.equal(scoredIntervals[0]?.brightnessLevel, "low");
assert.equal(scoredIntervals[0]?.contrastLevel, "low");
assert.equal(scoredIntervals[1]?.brightnessLevel, "high");
assert.equal(scoredIntervals[1]?.contrastLevel, "high");
const preferredBright = selectDiverseActionIntervals(scoredIntervals, 1);
assert.equal(preferredBright.length, 1);
assert.equal(preferredBright[0]?.intervalStartMs, 4_000);

const legacyParsed = shotSourceAnalysisSchema.parse({
  version: legacyShotAnalysisVersion,
  intervalStartMs: 0,
  intervalEndMs: 4_000,
  representativeMs: 2_000,
  actionScore: 40,
  actionLevel: "medium",
  startBoundary: "source",
  endBoundary: "source",
});
assert.equal(legacyParsed.version, legacyShotAnalysisVersion);

console.log(
  "PASS shot intervals use scene boundaries, signalstats brightness/contrast, and bounded visual-motion scores",
);
