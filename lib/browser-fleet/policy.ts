export type RunKind = "interactive" | "inbox" | "publish";
export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "quarantined"
  | "completed"
  | "failed"
  | "unknown";
export type AuthState =
  | "needs_login"
  | "needs_2fa"
  | "checkpoint"
  | "egress_mismatch"
  | "ready"
  | "result_unknown";
export type Limits = { maxBrowsers: number; memoryBudgetMb: number; browserMemoryMb: number };
export type Account = {
  id: string;
  channelRef: string;
  accountRef: string;
  // Older version-1 documents must be reconfigured before their next lease.
  expectedEgressIp?: string;
  enabled: boolean;
  authState: AuthState;
  credentialVersion: number;
  loginCiphertext: string | null;
  proxyCiphertext: string | null;
  pollSeconds: number;
  nextPollAt: number;
  lastCheckedAt: number | null;
};
export type Run = {
  id: string;
  accountId: string;
  kind: RunKind;
  jobRef: string | null;
  inboxCompletion?: {
    observedAt: number;
    reviewRef: string;
    coverage: "visible_inbox";
    conversationCount: number;
    messageCount: number;
  };
  inboxReceipts?: Array<{
    requestId: string;
    digest: string;
    accepted: number;
    duplicates: number;
  }>;
  publicationOutcome?: "published" | "unknown";
  requestedBy: string;
  authSessionId: string | null;
  createdAt: number;
  status: RunStatus;
  claimId: string | null;
  leaseId: string | null;
  leaseUntil: number;
  deadline: number;
  credentialVersion: number;
  stopRequested: boolean;
  failure: string | null;
  ticketHash: string | null;
  connectBefore: number;
  ticketUsed: boolean;
};
export type FleetState = {
  version: 1;
  limits: Limits;
  installationId: string | null;
  bootId: string | null;
  capabilities: RunKind[];
  publicationScopes?: Array<{ channelRef: string; accountRef: string; expiresAt: number }>;
  lastSeenAt: number;
  accounts: Account[];
  runs: Run[];
};
export const LEASE_MS = 90_000;
export const LIVE_STATUSES: RunStatus[] = ["starting", "running", "stopping", "quarantined"];
export const isLive = (run: Run) => LIVE_STATUSES.includes(run.status);
export function initialState(limits: Limits): FleetState {
  return {
    version: 1,
    limits,
    installationId: null,
    bootId: null,
    capabilities: [],
    lastSeenAt: 0,
    accounts: [],
    runs: [],
  };
}
export function bindInstallation(state: FleetState, installationId: string) {
  if (state.installationId && state.installationId !== installationId)
    throw new Error("node_already_installed");
  state.installationId = installationId;
}
export function availableSlots(state: FleetState, availableMemoryMb: number, localSlots: number) {
  if (![availableMemoryMb, localSlots].every((n) => Number.isFinite(n) && n >= 0)) return 0;
  const active = state.runs.filter(isLive).length;
  return Math.max(
    0,
    Math.min(
      state.limits.maxBrowsers - active,
      Math.floor(state.limits.memoryBudgetMb / state.limits.browserMemoryMb) - active,
      Math.floor(availableMemoryMb / state.limits.browserMemoryMb),
      Math.floor(localSlots) - active,
    ),
  );
}
export function enqueueRun(
  state: FleetState,
  input: Pick<Run, "id" | "accountId" | "kind" | "jobRef" | "requestedBy" | "authSessionId">,
  now: number,
) {
  const account = state.accounts.find((a) => a.id === input.accountId);
  if (!account?.enabled) throw new Error("account_not_authorized");
  // Publication idempotency survives completed/unknown outcomes; never blindly retry.
  const duplicate = state.runs.find(
    (r) =>
      r.accountId === input.accountId &&
      r.kind === input.kind &&
      (input.jobRef ? r.jobRef === input.jobRef : r.status === "queued" || isLive(r)),
  );
  if (duplicate) return duplicate;
  if (state.runs.filter((r) => r.status === "queued").length >= 200) throw new Error("queue_full");
  if (input.kind !== "interactive" && account.authState !== "ready")
    throw new Error("account_needs_attention");
  const run: Run = {
    ...input,
    createdAt: now,
    status: "queued",
    claimId: null,
    leaseId: null,
    leaseUntil: 0,
    deadline: 0,
    credentialVersion: account.credentialVersion,
    stopRequested: false,
    failure: null,
    ticketHash: null,
    connectBefore: 0,
    ticketUsed: false,
  };
  state.runs.push(run);
  return run;
}
export function sweep(state: FleetState, now: number) {
  for (const run of state.runs) {
    if (run.status === "queued" && run.kind === "interactive" && now - run.createdAt >= 900_000) {
      run.status = "failed";
      run.failure = "interactive_queue_expired";
    }
    if (isLive(run) && (run.leaseUntil <= now || run.deadline <= now)) {
      // Do not release the slot merely because the controller stopped responding.
      run.status = "quarantined";
      run.stopRequested = true;
      run.ticketHash = null;
      run.failure = "lease_expired_stop_unconfirmed";
    }
  }
  // Retain publication tombstones; other bounded history is only operational metadata.
  const terminal = state.runs.filter(
    (r) => r.kind !== "publish" && !isLive(r) && r.status !== "queued",
  );
  const prune = new Set(terminal.slice(0, Math.max(0, terminal.length - 50)).map((r) => r.id));
  state.runs = state.runs.filter((r) => !prune.has(r.id));
}
export function scheduleInbox(state: FleetState, now: number, newId: () => string) {
  if (!state.capabilities.includes("inbox")) return;
  for (const a of state.accounts) {
    if (!a.enabled || a.authState !== "ready" || a.pollSeconds === 0 || a.nextPollAt > now)
      continue;
    if (
      state.runs.some(
        (r) => r.accountId === a.id && r.kind === "inbox" && (r.status === "queued" || isLive(r)),
      )
    )
      continue;
    if (state.runs.filter((r) => r.status === "queued").length >= 200) break;
    enqueueRun(
      state,
      {
        id: newId(),
        accountId: a.id,
        kind: "inbox",
        jobRef: null,
        requestedBy: "scheduler",
        authSessionId: null,
      },
      now,
    );
  }
}
export function publicationScopeActive(state: FleetState, account: Account, now: number) {
  return (
    state.publicationScopes === undefined ||
    state.publicationScopes.some(
      (scope) =>
        scope.channelRef === account.channelRef &&
        scope.accountRef === account.accountRef &&
        scope.expiresAt > now,
    )
  );
}
export function claimRun(
  state: FleetState,
  input: { requestId: string; leaseId: string; availableMemoryMb: number; localSlots: number },
  now: number,
) {
  sweep(state, now);
  const previous = state.runs.find((r) => r.claimId === input.requestId);
  if (previous)
    return isLive(previous) && previous.status !== "quarantined" && !previous.stopRequested
      ? previous
      : null;
  if (!availableSlots(state, input.availableMemoryMb, input.localSlots)) return null;
  const occupied = new Set(state.runs.filter(isLive).map((r) => r.accountId));
  const weight = { interactive: 30, publish: 20, inbox: 10 };
  const priority = (r: Run) => weight[r.kind] + Math.floor((now - r.createdAt) / 300_000);
  const candidates = state.runs
    .filter((r) => {
      const a = state.accounts.find((a) => a.id === r.accountId);
      return (
        r.status === "queued" &&
        !r.stopRequested &&
        !occupied.has(r.accountId) &&
        a?.enabled &&
        state.capabilities.includes(r.kind) &&
        (r.kind !== "publish" || publicationScopeActive(state, a, now)) &&
        (r.kind === "interactive" || a.authState === "ready")
      );
    })
    .sort((a, b) => priority(b) - priority(a) || a.createdAt - b.createdAt);
  const run = candidates[0];
  if (!run) return null;
  const account = state.accounts.find((a) => a.id === run.accountId);
  if (!account) throw new Error("account_missing");
  run.status = "starting";
  run.claimId = input.requestId;
  run.leaseId = input.leaseId;
  run.credentialVersion = account.credentialVersion;
  run.deadline = now + { interactive: 600_000, inbox: 120_000, publish: 900_000 }[run.kind];
  run.leaseUntil = Math.min(now + LEASE_MS, run.deadline);
  return run;
}
export function renewRun(
  state: FleetState,
  runId: string,
  leaseId: string,
  ready: boolean,
  now: number,
) {
  const run = state.runs.find((r) => r.id === runId);
  const a = state.accounts.find((a) => a.id === run?.accountId);
  if (
    !run ||
    !a?.enabled ||
    run.leaseId !== leaseId ||
    !isLive(run) ||
    run.status === "quarantined" ||
    run.stopRequested ||
    run.leaseUntil <= now ||
    run.deadline <= now ||
    run.credentialVersion !== a.credentialVersion
  )
    return null;
  run.leaseUntil = Math.min(now + LEASE_MS, run.deadline);
  if (ready) run.status = "running";
  return run;
}
export function requestStop(state: FleetState, run: Run) {
  run.stopRequested = true;
  run.ticketHash = null;
  if (run.status === "queued") {
    run.status = "failed";
    run.failure = "cancelled";
  } else if (isLive(run)) run.status = "stopping";
}
export function finishRun(
  state: FleetState,
  runId: string,
  outcome:
    | "completed"
    | "failed"
    | "needs_login"
    | "needs_2fa"
    | "checkpoint"
    | "egress_mismatch"
    | "unknown",
  stopped: boolean,
  now: number,
) {
  const run = state.runs.find((r) => r.id === runId);
  if (!run || !isLive(run)) return;
  if (!stopped) {
    requestStop(state, run);
    return;
  }
  const a = state.accounts.find((a) => a.id === run.accountId);
  run.ticketHash = null;
  // Only a persisted, lease-bound business receipt establishes success.
  // Browser shutdown by itself remains unknown.
  const completed = outcome === "completed" && (run.kind !== "inbox" || !!run.inboxCompletion);
  run.status =
    run.kind === "publish"
      ? run.publicationOutcome === "published"
        ? "completed"
        : "unknown"
      : completed
        ? "completed"
        : "failed";
  run.failure =
    run.status === "completed"
      ? null
      : run.kind === "inbox" && outcome === "completed"
        ? "inbox_completion_missing"
        : outcome;
  if (a) {
    if (["needs_login", "needs_2fa", "checkpoint", "egress_mismatch"].includes(outcome))
      a.authState = outcome as AuthState;
    if (run.status === "unknown") a.authState = "result_unknown";
    else if (outcome === "unknown" && run.kind === "interactive") a.authState = "needs_login";
    if (run.kind === "inbox") {
      if (completed && run.inboxCompletion)
        a.lastCheckedAt = Math.max(a.lastCheckedAt ?? 0, run.inboxCompletion.observedAt);
      a.nextPollAt = now + Math.max(a.pollSeconds * 1000, completed ? 0 : 300_000);
    }
  }
}
export function publicState(state: FleetState) {
  return {
    limits: state.limits,
    lastSeenAt: state.lastSeenAt,
    capabilities: state.capabilities,
    accounts: state.accounts.map(({ loginCiphertext, proxyCiphertext, ...a }) => ({
      ...a,
      loginSaved: !!loginCiphertext,
      proxySaved: !!proxyCiphertext,
    })),
    runs: state.runs.map(
      ({ ticketHash, authSessionId, leaseId, claimId, inboxReceipts, ...r }) => ({ ...r }),
    ),
  };
}
