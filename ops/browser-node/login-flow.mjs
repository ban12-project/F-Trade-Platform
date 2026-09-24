import { generateTotp } from "./totp.mjs";

/** Credential submissions are one-shot. Observation may repeat, submission never does. */
export async function runFacebookLoginFlow({
  credentials,
  acquireCredentials,
  observeOnly = false,
  observe,
  submit,
  assertActive,
  onAttention,
  deadline,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const attempted = new Set();
  let highest = 0;
  let started = false;
  let unsettledReads = 0;
  let attentionReported = false;
  let credentialAcquisitionAttempted = false;
  const rank = { password: 1, totp: 2, messenger: 3, pin: 4 };
  const active = () => {
    assertActive();
    if (!Number.isFinite(deadline) || now() >= deadline) throw new Error("login_expired");
  };
  try {
    active();
    // Bound even a faulty clock/sleep implementation and an endlessly loading page.
    for (let poll = 0; poll < 360; poll++) {
      active();
      const observed = await observe();
      active();
      if (observed?.outcome === "unknown") return { outcome: "unknown", reason: "observation" };
      if (observed?.originVerified !== true || observed.accountMismatch === true)
        return { outcome: "refused", reason: "page_scope" };
      if (observed.state === "ready") {
        if (observed.identityVerified !== true || observed.messengerRestored !== true)
          return { outcome: "refused", reason: "ready_unverified" };
        return { outcome: "ready" };
      }
      if (observed.state === "checkpoint" && onAttention) {
        if (!attentionReported) {
          await onAttention("checkpoint");
          attentionReported = true;
        }
        await sleep(Math.min(500, Math.max(0, deadline - now())));
        continue;
      }
      if (["checkpoint", "rejected", "unsupported_factor"].includes(observed.state))
        return { outcome: "attention", reason: observed.state };
      const phase = observed.state;
      // Navigation can expose a new document before its form/identity hydrates.
      // Allow bounded reads only; wrong origins/accounts above still stop immediately.
      if (phase === "invalid" && unsettledReads++ < 20) {
        await sleep(Math.min(500, Math.max(0, deadline - now())));
        continue;
      }
      if (phase !== "invalid") unsettledReads = 0;
      if (phase === "loading" || (rank[phase] && attempted.has(phase) && rank[phase] === highest)) {
        await sleep(Math.min(500, Math.max(0, deadline - now())));
        continue;
      }
      if (observeOnly && phase === "messenger") {
        // The thread list can hydrate after account identity appears. Observe
        // until ready without issuing a page submission or claiming factors.
        await sleep(Math.min(500, Math.max(0, deadline - now())));
        continue;
      }
      if (observeOnly && ["password", "totp", "pin"].includes(phase))
        return { outcome: "refused", reason: "recovery_required" };
      if (!Object.hasOwn(rank, phase) || rank[phase] < highest)
        return { outcome: "refused", reason: "unexpected_phase" };
      if (phase !== "messenger" && !credentials && acquireCredentials) {
        // Only a positively observed recovery phase may release stored factors.
        // Consume before the request: a lost response must never trigger a second claim.
        if (credentialAcquisitionAttempted)
          return { outcome: "unknown", reason: "credential_claim" };
        credentialAcquisitionAttempted = true;
        active();
        credentials = await acquireCredentials(phase);
        active();
        if (!credentials || typeof credentials !== "object")
          return { outcome: "refused", reason: "credential_claim" };
      }
      let values;
      if (phase === "password") {
        if (!credentials?.username || !credentials?.password)
          return { outcome: "needs_credential", reason: "password" };
        values = { username: credentials.username, password: credentials.password };
      } else if (phase === "totp") {
        if (!credentials?.totpSecret) return { outcome: "needs_credential", reason: "totp" };
        let otp = generateTotp(credentials.totpSecret, now());
        if (otp.expiresAt - now() < 5000) {
          await sleep(Math.max(0, otp.expiresAt - now()) + 1);
          active();
          otp = generateTotp(credentials.totpSecret, now());
        }
        values = { code: otp.code, expiresAt: Math.min(deadline, otp.expiresAt) };
      } else if (phase === "messenger") {
        if (observed.identityVerified !== true) return { outcome: "refused", reason: "identity" };
        values = {};
      } else {
        if (!credentials?.messengerPin) return { outcome: "needs_credential", reason: "pin" };
        values = { code: credentials.messengerPin, expiresAt: deadline };
      }
      active();
      highest = rank[phase];
      attempted.add(phase); // Consume before an operation which may commit despite a lost response.
      started = true;
      let result;
      try {
        result = await submit(phase, values);
      } finally {
        for (const key of Object.keys(values)) delete values[key];
      }
      if (result !== "submitted")
        return { outcome: result === "refused" ? "refused" : "unknown", reason: "submission" };
    }
    return { outcome: "unknown", reason: "observation_limit" };
  } catch {
    // Exceptions from the browser may contain typed secrets. Never return exception contents.
    return {
      outcome: started || credentialAcquisitionAttempted ? "unknown" : "refused",
      reason: "execution",
    };
  } finally {
    if (credentials && typeof credentials === "object") {
      delete credentials.password;
      delete credentials.totpSecret;
      delete credentials.messengerPin;
    }
  }
}
