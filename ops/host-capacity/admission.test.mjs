import assert from "node:assert/strict";
import test from "node:test";
import { checkBudget } from "./admission.mjs";

const job = { HostConfig: { Memory: 2048 * 1048576, NanoCpus: 2e9 } };
test("shared budget allows two jobs on current VPS, irrespective of service", () => {
  checkBudget([], 2048, 6000, 7424, 4);
  checkBudget([job], 2048, 4000, 7424, 4);
  assert.throws(() => checkBudget([job, job], 2048, 4000, 7424, 4), /exhausted/);
});
test("hardware growth expands concurrency without changing a slot constant", () => {
  checkBudget([job, job, job], 2048, 7000, 16384, 8);
  assert.throws(() => checkBudget([job, job, job, job], 2048, 7000, 16384, 8), /exhausted/);
});
test("memory pressure, CPU capacity and unbounded workers fail closed", () => {
  assert.throws(() => checkBudget([], 2048, 3000, 7424, 4), /exhausted/);
  assert.throws(() => checkBudget([job], 2048, 8000, 16384, 2), /exhausted/);
  assert.throws(
    () => checkBudget([{ HostConfig: { Memory: 0 } }], 2048, 8000, 16384, 8),
    /unbounded/,
  );
});
