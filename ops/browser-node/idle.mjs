export function viewerGraceExpired(state, now) {
  // A viewer can close after completing CAPTCHA while the bounded automatic
  // task continues. Explicit stop, revocation and lease expiry remain separate.
  if (state.automatic && state.loginTask) return false;
  return (
    (!state.connected &&
      !state.pendingConnection &&
      !state.loginTask &&
      now - state.readyAt > 60000) ||
    (Boolean(state.disconnectedAt) && now - state.disconnectedAt > 15000)
  );
}

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
