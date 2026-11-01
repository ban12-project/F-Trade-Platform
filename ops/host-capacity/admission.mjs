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

// Both controllers lock the same host-owned inode. A killed controller releases
// the kernel lock; Docker's created containers are already counted as reserved.
export async function acquireHostCapacity(docker, memoryMb, env = process.env) {
  const directory = env.FTRADE_HOST_CAPACITY_DIR;
  if (!directory) return async () => {};
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
    checkBudget(details, memoryMb, await availableMemoryMb());
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
