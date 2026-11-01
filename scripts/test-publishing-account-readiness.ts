import assert from "node:assert/strict";
import { type Account, initialState } from "../lib/browser-fleet/policy";
import { publicationProgress } from "../lib/social/publication-presentation";
import { publishingAccountReadiness } from "../lib/social/publishing-account-policy";

const now = Date.now();
const account: Account = {
  id: "stable",
  displayName: "出口团队",
  channelRef: "facebook-personal",
  accountRef: "stable-ref",
  enabled: true,
  authState: "ready",
  loginCiphertext: "SYNTHETIC",
  proxyCiphertext: "SYNTHETIC",
  expectedEgressIp: "203.0.113.1",
  credentialVersion: 1,
  pollSeconds: 0,
  nextPollAt: 0,
  lastCheckedAt: null,
};
const state = {
  ...initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 }),
  installationId: "synthetic",
  bootId: "synthetic",
  lastSeenAt: now,
  capabilities: ["publish"] as const,
  accounts: [account],
};
const input = {
  id: account.id,
  nodeId: "node",
  account,
  channelRef: account.channelRef,
  accountRef: account.accountRef,
  state: { ...state, capabilities: [...state.capabilities] },
  nodeStatus: "active",
  control: { enabled: true, circuitStatus: "active", pauseReason: null },
};
assert.equal(publishingAccountReadiness(input, now).ready, true);
assert.deepEqual(publishingAccountReadiness({ ...input, control: undefined }, now).blockers, [
  "disabled",
]);
assert.deepEqual(
  publishingAccountReadiness(
    {
      ...input,
      account: { ...account, enabled: false, authState: "needs_2fa" },
      control: undefined,
    },
    now,
  ).blockers,
  ["grant", "login", "disabled"],
);
assert.deepEqual(
  publishingAccountReadiness(
    { ...input, state: { ...input.state, lastSeenAt: now - 90001, capabilities: ["interactive"] } },
    now,
  ).blockers,
  ["offline", "capability"],
);
assert.deepEqual(
  publishingAccountReadiness(
    {
      ...input,
      account: { ...account, authState: "result_unknown" },
      control: { enabled: false, circuitStatus: "paused", pauseReason: "unknown" },
    },
    now,
  ).blockers,
  ["unknown", "paused"],
);
assert.deepEqual(
  publishingAccountReadiness({ ...input, state: { ...input.state, publicationScopes: [] } }, now)
    .blockers,
  ["scope"],
);
assert.equal(publishingAccountReadiness({ ...input, account: undefined }, now).ready, false);
assert.equal(
  publishingAccountReadiness({ ...input, account: { ...account, displayName: "另一个名称" } }, now)
    .accountRef,
  account.accountRef,
);
assert.equal(publicationProgress("submitted", false, "queued").label, "待执行");
assert.equal(publicationProgress("submitted", false, "running").label, "执行中");
assert.equal(publicationProgress("unknown").label, "结果待人工核对");
assert.equal(publicationProgress("published").label, "已发布");
console.log("publishing account readiness: passed synthetic lifecycle and capability checks");
