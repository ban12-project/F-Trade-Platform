import assert from "node:assert/strict";

import { detectShotIntervals, parseFrameDifferenceMetadata, parseSceneCutMetadata, selectDiverseActionIntervals } from "../lib/video/shot-analysis";

const sceneMetadata = ["frame:8 pts:2 pts_time:2", "lavfi.scd.time=2", "lavfi.scd.time=bad", "lavfi.scd.time=7.5"].join("\n");
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
assert.deepEqual(parseFrameDifferenceMetadata(motionMetadata).map(({ timeMs, difference }) => ({ timeMs, difference })), [
  { timeMs: 250, difference: 2 },
  { timeMs: 1_250, difference: 4 },
  { timeMs: 2_250, difference: 25 },
  { timeMs: 3_250, difference: 30 },
  { timeMs: 7_750, difference: 12 },
]);

const intervals = detectShotIntervals({ durationMs: 30_000, sceneMetadata, motionMetadata });
assert.ok(intervals.length >= 4);
assert.ok(intervals.every((interval) => interval.intervalEndMs - interval.intervalStartMs <= 12_000));
assert.ok(intervals.every((interval) => interval.representativeMs >= interval.intervalStartMs && interval.representativeMs < interval.intervalEndMs));
assert.ok(intervals.some((interval) => interval.actionScore >= 75 && interval.actionLevel === "high"));
assert.equal(intervals[0]?.startBoundary, "source");
assert.equal(intervals.at(-1)?.endBoundary, "source");

const selected = selectDiverseActionIntervals(intervals, 3);
assert.equal(selected.length, 3);
assert.deepEqual(selected, [...selected].sort((left, right) => left.intervalStartMs - right.intervalStartMs));
assert.throws(() => selectDiverseActionIntervals(intervals, 0), /正整数/);
assert.throws(() => detectShotIntervals({ durationMs: 999, sceneMetadata: "", motionMetadata: "" }), /不足 1 秒/);

console.log("PASS shot intervals use scene boundaries and bounded visual-motion scores");
