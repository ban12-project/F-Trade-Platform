// Backend-only Camofox lease client. Neither the access key nor the release
// capability is exposed in the browser's gateway admission response.
const leases = new WeakMap();
async function request(slot, path, body) {
  if (
    !Number.isInteger(slot.apiPort) ||
    slot.apiPort < 1 ||
    slot.apiPort > 65535 ||
    typeof slot.accessKey !== "string" ||
    !slot.accessKey
  )
    throw new Error("control_unavailable");
  const response = await fetch(`http://127.0.0.1:${slot.apiPort}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${slot.accessKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error("control_request_failed"), { status: response.status });
  }
  return response.json();
}
export async function acquireBrowserControl(slot) {
  if (leases.has(slot)) throw new Error("control_cleanup_required");
  const ttlMs = Math.min(60000, Math.floor(slot.expiresAt - Date.now()));
  if (ttlMs < 1000 || typeof slot.run.accountId !== "string" || !slot.run.accountId)
    throw new Error("control_unavailable");
  const state = {};
  leases.set(slot, state);
  slot.controlPaused = true;
  const started = Date.now();
  let grant;
  try {
    grant = await request(slot, "/control/acquire", { userId: slot.run.accountId, ttlMs });
    if (
      grant.owner !== slot.run.accountId ||
      !/^[a-f0-9]{64}$/.test(grant.capability) ||
      !Number.isSafeInteger(grant.expiresAt)
    )
      throw new Error("control_response_invalid");
  } catch (error) {
    // A timed-out/invalid response may still represent a live grant. Do not
    // reopen automation or issue a replacement against uncertain input.
    slot.controlFailure = true;
    throw error;
  }
  let releasePromise;
  return {
    expiresAt: Math.min(started + ttlMs, grant.expiresAt),
    release() {
      if (leases.get(slot) !== state) return Promise.resolve();
      if (!releasePromise)
        releasePromise = (async () => {
          try {
            const result = await request(slot, "/control/release", {
              userId: slot.run.accountId,
              capability: grant.capability,
            });
            if (result.released !== true) throw new Error("control_release_unconfirmed");
          } catch (error) {
            // The server may already have expired this grant. A stale-capability
            // response alone is insufficient: also require stopped input.
            if (error.status !== 403 || Date.now() < grant.expiresAt) throw error;
            const status = await request(slot, "/vnc/status");
            if (
              status.enabled !== true ||
              status.running !== false ||
              status.watcherRunning !== false
            )
              throw error;
          }
          leases.delete(slot);
          slot.controlPaused = false;
          slot.controlFailure = false;
        })().catch((error) => {
          releasePromise = null;
          slot.controlFailure = true;
          throw error;
        });
      return releasePromise;
    },
  };
}

export async function withAutomationControl(slot, gateway, operation) {
  if (slot.automationHandoff) throw new Error("automation_handoff_active");
  slot.automationHandoff = true;
  try {
    await gateway.closeRun(slot.run.id);
    return await operation();
  } finally {
    slot.automationHandoff = false;
    // Leave a full reconnect window after a deliberate automation handoff.
    if (slot.disconnectedAt) slot.disconnectedAt = Date.now();
  }
}
