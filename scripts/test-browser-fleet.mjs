import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  availableSlots,
  bindInstallation,
  claimRun,
  enqueueRun,
  finishRun,
  initialState,
  publicState,
  renewRun,
  requestStop,
  scheduleInbox,
  sweep,
} from "../lib/browser-fleet/policy.ts";
import {
  accessKeyNodeId,
  createAccessKey,
  digest,
  matches,
  secureOrigin,
} from "../lib/browser-fleet/security.ts";

function fixture(slots = 1) {
  const state = initialState({ maxBrowsers: slots, memoryBudgetMb: 4096, browserMemoryMb: 2048 });
  state.capabilities = ["interactive", "inbox", "publish"];
  for (const id of ["a", "b", "c"])
    state.accounts.push({
      id,
      accountRef: id,
      channelRef: "facebook",
      enabled: true,
      authState: "ready",
      credentialVersion: 1,
      loginCiphertext: "encrypted-login",
      proxyCiphertext: "encrypted-proxy",
      pollSeconds: 900,
      nextPollAt: 0,
      lastCheckedAt: null,
    });
  return state;
}
function enqueue(state, accountId = "a", kind = "interactive", now = 1000, jobRef = null) {
  return enqueueRun(
    state,
    { id: randomUUID(), accountId, kind, jobRef, requestedBy: "owner", authSessionId: "session" },
    now,
  );
}
function claim(state, now = 1001, requestId = randomUUID()) {
  return claimRun(
    state,
    { requestId, leaseId: randomUUID(), availableMemoryMb: 8192, localSlots: 3 },
    now,
  );
}
test("one access key identifies only its node and is stored as a digest", () => {
  const id = randomUUID();
  const key = createAccessKey(id);
  assert.equal(accessKeyNodeId(key), id);
  assert.ok(matches(key, digest(key)));
  assert.equal(matches(`${key}x`, digest(key)), false);
  assert.throws(() => accessKeyNodeId("invalid"));
});
test("gateway origins require HTTPS and reject credentials/path/query", () => {
  assert.equal(secureOrigin("https://browser.example/"), "https://browser.example");
  for (const bad of [
    "http://x.example",
    "https://u:p@x.example",
    "https://x.example/path",
    "https://x.example/?token=a",
  ])
    assert.throws(() => secureOrigin(bad));
});
test("a node key cannot register a second independent installation", () => {
  const state = fixture();
  bindInstallation(state, "host-a");
  bindInstallation(state, "host-a");
  assert.throws(() => bindInstallation(state, "host-b"));
});
test("no queued work means no browser allocation", () => assert.equal(claim(fixture()), null));
test("slot and memory budgets both constrain allocation", () => {
  const s = fixture(3);
  assert.equal(availableSlots(s, 8192, 3), 2);
  assert.equal(availableSlots(s, 1024, 3), 0);
  assert.equal(availableSlots(s, Infinity, 3), 0);
  assert.equal(availableSlots(s, 8192, 1), 1);
});
test("claim requests are idempotent after a lost HTTP response", () => {
  const s = fixture(2);
  enqueue(s);
  enqueue(s, "b");
  const request = randomUUID();
  const a = claim(s, 1001, request);
  assert.equal(claim(s, 1002, request)?.id, a.id);
  assert.equal(s.runs.filter((r) => r.status === "starting").length, 1);
});
test("a full node leaves other accounts queued", () => {
  const s = fixture();
  enqueue(s);
  const b = enqueue(s, "b");
  claim(s);
  assert.equal(claim(s), null);
  assert.equal(b.status, "queued");
});
test("one account can never hold two simultaneous browser leases", () => {
  const s = fixture(3);
  enqueue(s, "a", "inbox");
  enqueue(s, "a", "interactive");
  assert.equal(claim(s).kind, "interactive");
  assert.equal(claim(s), null);
});
test("interactive requests outrank newly queued background polling", () => {
  const s = fixture();
  enqueue(s, "a", "inbox");
  enqueue(s, "b", "interactive");
  assert.equal(claim(s).accountId, "b");
});
test("aging prevents indefinite starvation", () => {
  const s = fixture();
  enqueue(s, "a", "inbox", 0);
  enqueue(s, "b", "interactive", 7_000_000);
  assert.equal(claim(s, 7_000_001).kind, "inbox");
});
test("manual requests do not preempt running work", () => {
  const s = fixture();
  enqueue(s, "a", "publish", 1000, "job");
  const run = claim(s);
  enqueue(s, "b", "interactive");
  assert.equal(claim(s), null);
  assert.equal(run.status, "starting");
});
test("duplicate polling is coalesced", () => {
  const s = fixture();
  scheduleInbox(s, 1000, randomUUID);
  scheduleInbox(s, 2000, randomUUID);
  assert.equal(s.runs.length, 3);
});
test("missing inbox executor never produces fake checks", () => {
  const s = fixture();
  s.capabilities = ["interactive"];
  scheduleInbox(s, 1000, randomUUID);
  assert.equal(s.runs.length, 0);
  assert.equal(s.accounts[0].lastCheckedAt, null);
});
test("expired leases quarantine capacity until shutdown is confirmed", () => {
  const s = fixture();
  enqueue(s);
  enqueue(s, "b");
  const r = claim(s);
  sweep(s, 100_000);
  assert.equal(r.status, "quarantined");
  assert.equal(claim(s, 100_001), null);
  finishRun(s, r.id, "failed", true, 100_002);
  assert.equal(claim(s, 100_003).accountId, "b");
});
test("stale lease cannot renew after quarantine", () => {
  const s = fixture();
  enqueue(s);
  const r = claim(s);
  sweep(s, 100_000);
  assert.equal(renewRun(s, r.id, r.leaseId, true, 100_001), null);
});
test("credential rotation invalidates a running lease", () => {
  const s = fixture();
  enqueue(s);
  const r = claim(s);
  s.accounts[0].credentialVersion++;
  assert.equal(renewRun(s, r.id, r.leaseId, true, 2000), null);
});
test("disabled grants cannot renew or claim", () => {
  const s = fixture();
  enqueue(s);
  const r = claim(s);
  s.accounts[0].enabled = false;
  assert.equal(renewRun(s, r.id, r.leaseId, true, 2000), null);
  assert.throws(() => enqueue(s));
});
test("wrong run lease identifier is rejected", () => {
  const s = fixture();
  enqueue(s);
  const r = claim(s);
  assert.equal(renewRun(s, r.id, randomUUID(), true, 2000), null);
});
test("renewal cannot exceed the hard interactive deadline", () => {
  const s = fixture();
  enqueue(s);
  const r = claim(s);
  for (let t = 2000; t < r.deadline; t += 10_000) assert.ok(renewRun(s, r.id, r.leaseId, true, t));
  assert.equal(r.leaseUntil, r.deadline);
  assert.equal(renewRun(s, r.id, r.leaseId, true, r.deadline), null);
});
test("stop requests do not immediately free occupied memory slots", () => {
  const s = fixture();
  enqueue(s);
  const r = claim(s);
  requestStop(s, r);
  assert.equal(availableSlots(s, 8192, 3), 0);
  finishRun(s, r.id, "completed", false, 2000);
  assert.equal(r.status, "stopping");
});
test("2FA marks attention and prevents unattended polling", () => {
  const s = fixture();
  enqueue(s, "a", "inbox");
  const r = claim(s);
  finishRun(s, r.id, "needs_2fa", true, 2000);
  assert.equal(s.accounts[0].authState, "needs_2fa");
  scheduleInbox(s, 3_000_000, randomUUID);
  assert.equal(
    s.runs.some((r) => r.accountId === "a" && r.status === "queued"),
    false,
  );
  assert.ok(enqueue(s, "a", "interactive", 3_000_000));
});
test("persisted inbox completion advances observation time, not shutdown time", () => {
  const s = fixture();
  enqueue(s, "a", "inbox");
  const r = claim(s);
  r.inboxCompletion = {
    observedAt: 1800,
    reviewRef: "evidence-synthetic",
    coverage: "visible_inbox",
    conversationCount: 0,
    messageCount: 0,
  };
  finishRun(s, r.id, "completed", true, 2000);
  assert.equal(s.accounts[0].lastCheckedAt, 1800);
  assert.equal(s.accounts[0].nextPollAt, 902_000);
});
test("browser exit never becomes a publication success or an automatic retry", () => {
  const s = fixture();
  const r = enqueue(s, "a", "publish", 1000, "job-1");
  claim(s);
  finishRun(s, r.id, "completed", true, 2000);
  assert.equal(r.status, "unknown");
  assert.equal(enqueue(s, "a", "publish", 3000, "job-1").id, r.id);
});
test("control-plane DTO never exposes vault ciphertext or connection secrets", () => {
  const s = fixture();
  const r = enqueue(s);
  r.ticketHash = "ticket-private";
  r.leaseId = "lease-private";
  const out = JSON.stringify(publicState(s));
  for (const secret of [
    "encrypted-login",
    "encrypted-proxy",
    "ticket-private",
    "lease-private",
    "authSessionId",
  ])
    assert.equal(out.includes(secret), false);
});
test("expired queued interactive requests do not wake a browser", () => {
  const s = fixture();
  const r = enqueue(s, "a", "interactive", 0);
  assert.equal(claim(s, 900_000), null);
  assert.equal(r.failure, "interactive_queue_expired");
});
test("inbox is paused until a human verifies a new account", () => {
  const s = fixture();
  s.accounts[0].authState = "needs_login";
  assert.throws(() => enqueue(s, "a", "inbox"));
  assert.ok(enqueue(s));
});

test("publication profiles constrain queued claims by account, channel and expiry", () => {
  for (const scope of [
    { channelRef: "other", accountRef: "a", expiresAt: 5000 },
    { channelRef: "facebook", accountRef: "b", expiresAt: 5000 },
    { channelRef: "facebook", accountRef: "a", expiresAt: 1001 },
  ]) {
    const state = fixture();
    state.publicationScopes = [scope];
    const run = enqueue(state, "a", "publish", 1000, "job");
    assert.equal(claim(state, 1001), null);
    assert.equal(run.status, "queued");
    state.publicationScopes = [{ channelRef: "facebook", accountRef: "a", expiresAt: 5000 }];
    assert.equal(claim(state, 1002)?.id, run.id);
  }
});

test("unreceipted inbox completion never advances the check time", () => {
  const s = fixture();
  enqueue(s, "a", "inbox");
  const r = claim(s);
  finishRun(s, r.id, "completed", true, 2000);
  assert.equal(r.status, "failed");
  assert.equal(r.failure, "inbox_completion_missing");
  assert.equal(s.accounts[0].lastCheckedAt, null);
  assert.ok(s.accounts[0].nextPollAt >= 302000);
});

test("inbox profile scope gates scheduling and queued claims without affecting manual login", () => {
  const s = fixture();
  s.inboxScopes = [{ channelRef: "facebook", accountRef: "a", expiresAt: 2000 }];
  scheduleInbox(s, 1000, randomUUID);
  assert.deepEqual(
    s.runs.map((run) => run.accountId),
    ["a"],
  );
  assert.equal(claim(s, 2000), null);
  const manual = enqueue(s, "b", "interactive", 2000);
  assert.equal(claim(s, 2001)?.id, manual.id);
});
