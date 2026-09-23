import assert from "node:assert/strict";
import { runFacebookLoginFlow } from "../ops/browser-node/login-flow.mjs";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
async function run(states, overrides = {}) {
  let time = 60000;
  const submissions = [];
  const credentials = {
    username: "synthetic",
    password: "synthetic-password",
    totpSecret: secret,
    messengerPin: "123456",
  };
  const result = await runFacebookLoginFlow({
    credentials,
    observe: async () => ({ originVerified: true, ...states.shift() }),
    submit: async (phase, values) => {
      submissions.push({ phase, ...values });
      return "submitted";
    },
    assertActive() {},
    deadline: 90000,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    ...overrides,
  });
  return { result, submissions, credentials };
}
const ready = { state: "ready", identityVerified: true, messengerRestored: true };
const happy = await run([
  { state: "password" },
  { state: "password" },
  { state: "totp" },
  { state: "pin" },
  ready,
]);
assert.equal(happy.result.outcome, "ready");
assert.deepEqual(
  happy.submissions.map((s) => s.phase),
  ["password", "totp", "pin"],
);
assert.match(happy.submissions[1].code, /^\d{6}$/);
assert.equal(happy.credentials.totpSecret, undefined);
assert.equal(happy.credentials.password, undefined);
assert.equal((await run([ready])).submissions.length, 0);
assert.equal((await run([{ state: "ready" }])).result.reason, "ready_unverified");
assert.equal((await run([{ state: "password", accountMismatch: true }])).submissions.length, 0);
assert.equal((await run([{ state: "checkpoint" }])).result.outcome, "attention");
let attentionCalls = 0;
const handoff = await run(
  [
    { state: "password" },
    { state: "checkpoint" },
    { state: "checkpoint" },
    { state: "totp" },
    { state: "pin" },
    ready,
  ],
  {
    onAttention: async (reason) => {
      assert.equal(reason, "checkpoint");
      attentionCalls++;
    },
  },
);
assert.equal(handoff.result.outcome, "ready");
assert.equal(attentionCalls, 1);
assert.deepEqual(
  handoff.submissions.map((s) => s.phase),
  ["password", "totp", "pin"],
);
const lostAttention = await run([{ state: "password" }, { state: "checkpoint" }, ready], {
  onAttention: async () => {
    throw Error("receipt_lost");
  },
});
assert.equal(lostAttention.result.outcome, "unknown");
assert.equal(lostAttention.submissions.length, 1);
const attentionExpired = await run([], {
  observe: async () => ({ state: "checkpoint", originVerified: true }),
  onAttention: async () => {},
});
assert.equal(attentionExpired.result.outcome, "refused");
assert.equal(attentionExpired.submissions.length, 0);
const observationFailure = await run([{ state: "password" }, { outcome: "unknown" }, ready]);
assert.equal(observationFailure.result.outcome, "unknown");
assert.equal(observationFailure.submissions.length, 1);
const hydration = await run([
  { state: "invalid" },
  { state: "totp" },
  { state: "invalid" },
  { state: "invalid" },
  { state: "messenger", identityVerified: true },
  ready,
]);
assert.equal(hydration.result.outcome, "ready");
assert.deepEqual(
  hydration.submissions.map((s) => s.phase),
  ["totp", "messenger"],
);
const unrecognized = await run([
  { state: "password" },
  ...Array.from({ length: 21 }, () => ({ state: "invalid" })),
  ready,
]);
assert.equal(unrecognized.result.outcome, "refused");
assert.equal(unrecognized.submissions.length, 1);
for (const invalidScope of [{ originVerified: false }, { accountMismatch: true }]) {
  const stopped = await run([{ state: "password" }, { state: "invalid", ...invalidScope }, ready]);
  assert.equal(stopped.result.reason, "page_scope");
  assert.equal(stopped.submissions.length, 1);
}
assert.equal((await run([{ state: "pin" }, { state: "password" }])).submissions.length, 1);
const lost = await run([{ state: "password" }, ready], {
  submit: async () => {
    throw new Error("synthetic-password");
  },
});
assert.equal(lost.result.outcome, "unknown");
assert.ok(!JSON.stringify(lost.result).includes("synthetic-password"));
const loading = await run([], {
  observe: async () => ({ state: "loading", originVerified: true }),
});
assert.equal(loading.result.outcome, "refused");
assert.equal(loading.submissions.length, 0);
const nearExpiry = await run([{ state: "totp" }, ready], {
  now: () => 59999,
  sleep: async () => {
    throw new Error("cancelled");
  },
});
assert.equal(nearExpiry.submissions.length, 0);
console.log(
  "PASS bounded login transitions, verified ready, one-shot submissions, cancellation and secret disposal",
);
