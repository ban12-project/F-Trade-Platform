import assert from "node:assert/strict";
import test from "node:test";
import { claimRun, enqueueRun, finishRun, initialState } from "../lib/browser-fleet/policy.ts";
import {
  describeEgressFailure,
  EGRESS_URL,
  openEgressCheckedSession,
  readEgressSnapshot,
  verifyBrowserEgress,
} from "../ops/browser-node/egress.mjs";

const run = {
  id: "synthetic-run",
  accountId: "synthetic-account",
  kind: "interactive",
  expectedEgressIp: "203.0.113.10",
};
const snapshot = (ip = run.expectedEgressIp) => ({
  url: EGRESS_URL,
  snapshot: `- generic: ${ip}`,
  truncated: false,
  hasMore: false,
});
function transport(observation = snapshot()) {
  const calls = [];
  return {
    calls,
    request: async (path, body) => {
      calls.push({ path, body });
      if (path.endsWith("/navigate")) return Response.json({ url: EGRESS_URL });
      if (path.includes("/snapshot?")) return Response.json(observation);
      return Response.json({ tabId: "probe", url: body.url });
    },
  };
}
test("Facebook is opened only after a browser-path IP match, within the same account session", async () => {
  const { request, calls } = transport();
  assert.equal(await openEgressCheckedSession(request, run), "probe");
  assert.deepEqual(
    calls.map((c) => c.path),
    [
      "/tabs",
      "/tabs/probe/navigate",
      "/tabs/probe/snapshot?userId=synthetic-account&format=json&includeScreenshot=false",
      "/tabs",
    ],
  );
  assert.equal(calls.at(-1).body.url, "https://www.facebook.com/");
  assert.equal(calls.at(-1).body.sessionKey, calls[0].body.sessionKey);
  assert.ok(calls.every((c) => !c.body || c.body.userId === run.accountId));
});
test("missing expected IP rejects before any browser request", async () => {
  const { request, calls } = transport();
  await assert.rejects(openEgressCheckedSession(request, { ...run, expectedEgressIp: undefined }));
  assert.equal(calls.length, 0);
});
test("wrong IP, redirect, challenge, truncated and ambiguous observation never open Facebook", async () => {
  for (const value of [
    snapshot("203.0.113.11"),
    { ...snapshot(), url: "https://other.example/" },
    { ...snapshot(), truncated: true },
    { ...snapshot(), hasMore: true },
    { ...snapshot(), snapshot: "- generic: challenge" },
    { ...snapshot(), snapshot: "- generic: 203.0.113.10\n- generic: 203.0.113.11" },
  ]) {
    const { request, calls } = transport(value);
    await assert.rejects(openEgressCheckedSession(request, run));
    assert.equal(
      calls.some((c) => c.body?.url === "https://www.facebook.com/"),
      false,
    );
  }
});
test("transport error and oversized metadata fail closed", async () => {
  await assert.rejects(
    openEgressCheckedSession(async () => {
      throw new Error("timeout");
    }, run),
  );
  await assert.rejects(
    openEgressCheckedSession(async () => new Response(" ".repeat(16_385)), run),
    /egress_response_limit/,
  );
});
test("active-session recheck detects changed egress without touching the Facebook tab", async () => {
  const { request, calls } = transport(snapshot("203.0.113.11"));
  await assert.rejects(verifyBrowserEgress(request, run, "probe"), /egress_ip_mismatch/);
  assert.equal(
    calls.some((c) => c.path === "/tabs"),
    false,
  );
});
test("IPv6 canonical representations compare equally; arbitrary embedded IPs are rejected", () => {
  readEgressSnapshot(snapshot("2001:db8::1"), "2001:0db8:0:0:0:0:0:1");
  readEgressSnapshot(
    { ...snapshot(), snapshot: '- generic: "203.0.113.10"' },
    run.expectedEgressIp,
  );
  assert.throws(() =>
    readEgressSnapshot({ ...snapshot(), snapshot: '- link "203.0.113.10"' }, run.expectedEgressIp),
  );
});
test("egress failure pauses background work and is not a successful inbox check", () => {
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
  state.capabilities = ["inbox"];
  state.accounts.push({
    id: run.accountId,
    enabled: true,
    authState: "ready",
    credentialVersion: 1,
    pollSeconds: 300,
    lastCheckedAt: null,
  });
  const queued = enqueueRun(
    state,
    {
      id: run.id,
      accountId: run.accountId,
      kind: "inbox",
      jobRef: null,
      requestedBy: "scheduler",
      authSessionId: null,
    },
    1000,
  );
  claimRun(
    state,
    { requestId: "claim", leaseId: "lease", availableMemoryMb: 4096, localSlots: 1 },
    1000,
  );
  finishRun(state, queued.id, "egress_mismatch", true, 1001);
  assert.equal(state.accounts[0].authState, "egress_mismatch");
  assert.equal(state.accounts[0].lastCheckedAt, null);
  assert.equal(queued.status, "failed");
  assert.throws(() => enqueueRun(state, { ...queued, id: "new" }, 1002), /account_needs_attention/);
});

test("egress diagnostics distinguish observed mismatch from failed observation without secrets", async () => {
  for (const [request, expected] of [
    [transport(snapshot("203.0.113.11")).request, "egress_ip_mismatch"],
    [
      transport({ ...snapshot(), snapshot: "- generic: challenge" }).request,
      "egress_observation_invalid",
    ],
    [async () => new Response("not json: SECRET"), "egress_observation_unavailable"],
    [
      async () => {
        throw Object.assign(new Error("SECRET proxy credentials and URL"), {
          browserFailureCode: "ssl_error",
          browserRequestStage: "navigate",
          browserHttpStatus: 502,
        });
      },
      "egress_observation_unavailable",
    ],
  ]) {
    let caught;
    try {
      await verifyBrowserEgress(request, run, "probe");
    } catch (error) {
      caught = error;
    }
    assert.ok(caught);
    const detail = describeEgressFailure(caught);
    assert.equal(detail.reason, expected);
    assert.equal(JSON.stringify(detail).includes("SECRET"), false);
    assert.equal(JSON.stringify(detail).includes(run.expectedEgressIp), false);
    if (caught.browserFailureCode)
      assert.deepEqual(detail, {
        event: "browser_egress_failed",
        reason: expected,
        request: "navigate",
        code: "ssl_error",
        httpStatus: 502,
      });
  }
  assert.deepEqual(
    describeEgressFailure({
      message: "SECRET",
      browserFailureCode: "SECRET",
      browserRequestStage: "SECRET",
      browserHttpStatus: "SECRET",
    }),
    {
      event: "browser_egress_failed",
      reason: "egress_observation_unavailable",
      request: "unknown",
      code: "unclassified",
      httpStatus: null,
    },
  );
});
