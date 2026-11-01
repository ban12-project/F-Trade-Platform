import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";

export async function availableMemoryMb() {
  const meminfo = await readFile("/proc/meminfo", "utf8");
  const available = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo);
  if (!available) throw new Error("host_capacity_memory_unavailable");
  return Number(available[1]) / 1024;
}

export function checkBudget(
  containers,
  memoryMb,
  availableMb,
  totalMb = totalmem() / 1048576,
  cores = cpus().length,
) {
  let memory = 0,
    cpu = 0;
  for (const c of containers) {
    const h = c.HostConfig;
    if (!(h?.Memory > 0) || !(h.NanoCpus > 0)) throw new Error("host_capacity_unbounded_worker");
    memory += h.Memory / 1048576;
    cpu += h.NanoCpus / 1e9;
  }
  const budget = totalMb - Math.max(2048, totalMb * 0.2);
  const reserve = Math.max(1536, totalMb * 0.1);
  if (
    containers.length >= 16 ||
    memory + memoryMb > budget ||
    cpu + 2 > cores ||
    availableMb < memoryMb + reserve
  )
    throw new Error("host_capacity_exhausted");
}

export function checkAdaptiveBudget(
  containers,
  memoryMb,
  cpuCores,
  availableMb,
  totalMb,
  cores,
  snapshot,
  now,
) {
  let memory = 0,
    demand = 0,
    footprint = 0;
  const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  let host;
  try {
    if (
      snapshot.version !== 1 ||
      snapshot.healthy !== true ||
      !number(snapshot.observedAt) ||
      now - snapshot.observedAt < 0 ||
      now - snapshot.observedAt > 8
    )
      throw new Error();
    host = snapshot.host;
    if (
      ![
        "cpuCount",
        "totalMb",
        "availableMb",
        "samples",
        "cpuPeakCores",
        "memorySomeAvg10",
        "memoryFullAvg10",
      ].every((k) => number(host[k]))
    )
      throw new Error();
    if (host.samples < 3 || host.cpuCount !== cores || Math.abs(host.totalMb - totalMb) > 2)
      throw new Error();
    for (const c of containers) {
      const h = c.HostConfig;
      if (!(h?.Memory > 0) || !(h.NanoCpus > 0)) throw new Error();
      memory += h.Memory / 1048576;
      const w = snapshot.workers[c.Id];
      if (!w) {
        const started = Date.parse(c.State?.StartedAt) / 1000;
        if (
          c.State?.Status !== "created" &&
          !(number(started) && now - started >= 0 && now - started <= 8)
        )
          throw new Error();
        demand += h.NanoCpus / 1e9;
        footprint += h.Memory / 1048576;
        continue;
      }
      if (
        !["samples", "memoryMb", "memoryPeakMb", "cpuPeakCores", "oomKills"].every((k) =>
          number(w[k]),
        ) ||
        w.oomKills
      )
        throw new Error();
      if (w.samples < 3) {
        demand += h.NanoCpus / 1e9;
        footprint += h.Memory / 1048576;
        continue;
      }
      demand += Math.max(Math.min(0.25, h.NanoCpus / 1e9), w.cpuPeakCores * 1.25);
      footprint += Math.max(w.memoryMb * 1.25, w.memoryPeakMb * 1.1);
    }
  } catch {
    throw new Error("host_capacity_telemetry_unavailable");
  }
  const budget = totalMb - Math.max(2048, totalMb * 0.2);
  const reserve = Math.max(1536, totalMb * 0.1);
  const cpuBudget = cores - Math.max(0.5, cores * 0.1);
  if (
    containers.length >= 16 ||
    memory + memoryMb > budget ||
    footprint + memoryMb > budget ||
    Math.min(availableMb, host.availableMb) < memoryMb + reserve ||
    demand + cpuCores > cpuBudget ||
    host.cpuPeakCores + cpuCores > cpuBudget ||
    host.memorySomeAvg10 > 5 ||
    host.memoryFullAvg10 > 1
  )
    throw new Error("host_capacity_exhausted");
}

// Both controllers lock the same host-owned inode. A killed controller releases
// the kernel lock; Docker's created containers are already counted as reserved.
export async function acquireHostCapacity(docker, memoryMb, env = process.env) {
  const directory = env.FTRADE_HOST_CAPACITY_DIR;
  if (!directory) {
    if (env.FTRADE_HOST_ADAPTIVE === "1") throw new Error("host_capacity_directory_invalid");
    return async () => {};
  }
  if (directory !== "/run/ftrade-capacity") throw new Error("host_capacity_directory_invalid");
  const child = spawn(
    "flock",
    [
      "-x",
      "-n",
      `${directory}/admission.lock`,
      process.execPath,
      "-e",
      "console.log('locked');process.stdin.resume();process.stdin.on('end',()=>process.exit(0))",
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.stdin.on("error", () => {});
  const release = async () => {
    child.stdin.end();
    await closed;
  };
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => reject(new Error("host_capacity_busy")));
      child.stdout.once("data", (data) =>
        data.toString() === "locked\n"
          ? resolve()
          : reject(new Error("host_capacity_lock_invalid")),
      );
    });
    const rows = await docker("GET", "/containers/json?all=true");
    const workers = rows.filter(
      (c) =>
        ["created", "running", "restarting", "paused"].includes(c.State) &&
        (c.Labels?.["io.ftrade.run"] || Object.hasOwn(c.Labels ?? {}, "io.ftrade.compute")),
    );
    const details = await Promise.all(
      workers.map((c) => docker("GET", `/containers/${c.Id}/json`)),
    );
    if (env.FTRADE_HOST_ADAPTIVE === "1") {
      let snapshot;
      try {
        snapshot = JSON.parse(await readFile(`${directory}/telemetry.json`, "utf8"));
      } catch {
        throw new Error("host_capacity_telemetry_unavailable");
      }
      checkAdaptiveBudget(
        details,
        memoryMb,
        2,
        await availableMemoryMb(),
        totalmem() / 1048576,
        cpus().length,
        snapshot,
        Date.now() / 1000,
      );
    } else {
      checkBudget(details, memoryMb, await availableMemoryMb());
    }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
