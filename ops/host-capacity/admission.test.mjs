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

test("adaptive decision fixtures match Python, including missing/stale telemetry", async () => {
  const { readFile } = await import("node:fs/promises");
  const { checkAdaptiveBudget } = await import("./admission.mjs");
  const fixtures = JSON.parse(
    await readFile(new URL("./adaptive-fixtures.json", import.meta.url), "utf8"),
  );
  for (const scenario of fixtures.cases) {
    const f = structuredClone(fixtures.base);
    for (const patch of scenario.changes) {
      const parent = patch.path.slice(0, -1).reduce((value, key) => value[key], f);
      const key = patch.path.at(-1);
      if (patch.remove) delete parent[key];
      else parent[key] = patch.value;
    }
    f.allowed = scenario.allowed;
    f.name = scenario.name;
    const run = () =>
      checkAdaptiveBudget(
        f.containers,
        f.memoryMb,
        f.cpuCores,
        f.availableMb,
        f.totalMb,
        f.cores,
        f.snapshot,
        f.now,
      );
    if (f.allowed) assert.doesNotThrow(run, f.name);
    else assert.throws(run, /host_capacity_/, f.name);
  }
});

test("adaptive mode cannot silently run without a shared lock directory", async () => {
  const { acquireHostCapacity } = await import("./admission.mjs");
  await assert.rejects(
    acquireHostCapacity(() => {}, 512, { FTRADE_HOST_ADAPTIVE: "1" }),
    /directory_invalid/,
  );
});
