/** A successful empty claim is evidence of idleness; errors are not. */
export function createIdleExitPolicy(env = process.env) {
  const mode = env.BROWSER_NODE_ON_DEMAND ?? "0";
  if (!["0", "1"].includes(mode)) throw new Error("node_on_demand_invalid");
  const idleMs = Number(env.BROWSER_NODE_IDLE_MS ?? 30_000);
  if (!Number.isInteger(idleMs) || idleMs < 1000 || idleMs > 60_000)
    throw new Error("node_idle_timeout_invalid");
  let emptySince = null;
  return {
    observe(empty, now) {
      if (mode !== "1" || !empty) {
        emptySince = null;
        return false;
      }
      emptySince ??= now;
      return now - emptySince >= idleMs;
    },
  };
}
