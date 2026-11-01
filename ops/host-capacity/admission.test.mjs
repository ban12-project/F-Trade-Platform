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

test("release drain refuses new admissions until its marker is removed", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { assertNotDraining } = await import("./admission.mjs");
  const dir = await mkdtemp(join(tmpdir(), "ftrade-drain-"));
  try {
    await assertNotDraining(dir);
    await writeFile(join(dir, "drain.json"), "{}");
    await assert.rejects(assertNotDraining(dir), /host_capacity_draining/);
    await rm(join(dir, "drain.json"));
    await assertNotDraining(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser startup downgrades only exhausted CPU admission and enforces a bounded grant", async () => {
  const { acquireBrowserCapacity, checkAdaptiveBudget } = await import("./admission.mjs");
  const calls = [];
  const first = { Id: "first", HostConfig: { Memory: 2560 * 1048576, NanoCpus: 2e9 } };
  const snapshot = {
    version: 1,
    healthy: true,
    observedAt: 100,
    host: {
      cpuCount: 4,
      totalMb: 7424,
      availableMb: 4500,
      samples: 5,
      cpuPeakCores: 2.2,
      memorySomeAvg10: 0,
      memoryFullAvg10: 0,
    },
    workers: {
      first: { samples: 8, memoryMb: 1500, memoryPeakMb: 1700, cpuPeakCores: 1.9, oomKills: 0 },
    },
  };
  const release = () => {};
  const acquire = async (_docker, memory, _env, cpu) => {
    calls.push(cpu);
    checkAdaptiveBudget([first], memory, cpu, 4500, 7424, 4, snapshot, 101);
    return release;
  };
  const grant = await acquireBrowserCapacity(null, 2560, { FTRADE_HOST_ADAPTIVE: "1" }, acquire);
  assert.deepEqual(calls, [2, 1]);
  assert.equal(grant.cpuCores, 1);
  assert.equal(grant.release, release);
  await assert.rejects(
    acquireBrowserCapacity(null, 4096, { FTRADE_HOST_ADAPTIVE: "1" }, acquire),
    /exhausted/,
  );
});

test("browser startup never retries drain, stale telemetry, lock errors or nonadaptive admission", async () => {
  const { acquireBrowserCapacity } = await import("./admission.mjs");
  for (const [message, env] of [
    ["host_capacity_draining", { FTRADE_HOST_ADAPTIVE: "1" }],
    ["host_capacity_telemetry_unavailable", { FTRADE_HOST_ADAPTIVE: "1" }],
    ["host_capacity_busy", { FTRADE_HOST_ADAPTIVE: "1" }],
    ["host_capacity_exhausted", {}],
  ]) {
    let attempts = 0;
    await assert.rejects(
      acquireBrowserCapacity(null, 2560, env, async () => {
        attempts++;
        throw new Error(message);
      }),
      { message },
    );
    assert.equal(attempts, 1);
  }
});
