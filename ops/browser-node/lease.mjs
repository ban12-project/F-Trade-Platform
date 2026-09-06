/** Translate a server lease into a conservative local deadline, accounting for RTT. */
export function localDeadline(result, leaseUntil) {
  const ttl = Math.min(90_000, leaseUntil - result.serverNow) - result.roundTripMs - 5000;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("lease_response_expired");
  return Date.now() + ttl;
}
/** Only call before any Docker create/start. A rejected claim still reserved a
 * server slot, so explicitly release it. A lost acknowledgement must propagate:
 * the caller keeps its request id and safely reconciles the same claim again.
 */
export async function prepareClaimBeforeStart(result, prepare, acknowledgeStopped) {
  try {
    return prepare(result);
  } catch {
    await acknowledgeStopped({
      runId: result.run.id,
      leaseId: result.run.leaseId,
      stopped: true,
      outcome: "failed",
    });
    return null;
  }
}
