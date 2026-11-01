import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialState } from "../lib/browser-fleet/policy";
import { publicationInspectionRuntimeOrigin } from "../lib/browser-fleet/publication-inspection-runtime";
import type { BrowserSandboxProvider } from "../lib/browser-fleet/sandbox-provider";
import {
  assertBrowserVpsCutoverDrained,
  verifyBrowserVpsRestore,
} from "../lib/browser-fleet/vps-migration-contract";

async function main() {
  const nodeId = randomUUID(),
    accountId = randomUUID(),
    historicalId = randomUUID();
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
  state.installationId = randomUUID();
  state.accounts.push({
    id: accountId,
    channelRef: "synthetic",
    accountRef: "synthetic",
    enabled: false,
    authState: "needs_login",
    credentialVersion: 1,
    loginCiphertext: null,
    proxyCiphertext: null,
    pollSeconds: 0,
    nextPollAt: 0,
    lastCheckedAt: null,
  });
  const source = {
    nodeId,
    installationId: state.installationId,
    nodeState: { name: "ftrade-browser-sandbox_node-state", sha256: "a".repeat(64) },
    accountVolumes: [accountId, historicalId].map((id) => ({
      name: `ftbrowser-${nodeId}-${id}`,
      sha256: "b".repeat(64),
      nodeId,
      accountId: id,
    })),
    privateConfigSha256: "c".repeat(64),
    agentImage: `sha256:${"d".repeat(64)}`,
    browserImage: `sha256:${"e".repeat(64)}`,
    nativeProfiles: true,
  };
  assert.equal(
    verifyBrowserVpsRestore(
      source,
      { ...source, accountVolumes: [...source.accountVolumes].reverse() },
      state,
    ).preservedVolumes,
    2,
  );
  for (const target of [
    { ...source, accountVolumes: source.accountVolumes.slice(0, 1) },
    { ...source, accountVolumes: [...source.accountVolumes, source.accountVolumes[0]] },
    { ...source, nodeState: { ...source.nodeState, sha256: "f".repeat(64) } },
    { ...source, nativeProfiles: false },
    { ...source, installationId: randomUUID() },
    { ...source, privateConfigSha256: "f".repeat(64) },
  ])
    assert.throws(() => verifyBrowserVpsRestore(source, target, state));
  const updatedAgent = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => verifyBrowserVpsRestore(source, { ...source, agentImage: updatedAgent }, state),
    /migration_agent_image_not_approved/,
  );
  assert.equal(
    verifyBrowserVpsRestore(source, { ...source, agentImage: updatedAgent }, state, updatedAgent)
      .preservedVolumes,
    2,
  );
  assertBrowserVpsCutoverDrained(state);
  for (const status of ["queued", "starting", "running", "stopping", "quarantined"] as const) {
    assert.throws(
      () =>
        assertBrowserVpsCutoverDrained({
          ...state,
          runs: [{ status } as (typeof state.runs)[number]],
        }),
      /migration_requires_drained_queue/,
    );
  }
  assertBrowserVpsCutoverDrained({
    ...state,
    runs: [{ status: "unknown", kind: "publish" } as (typeof state.runs)[number]],
  });
  let queried = 0;
  const provider = {
    get: async () => {
      queried++;
      throw Error("must_not_query_vercel_for_vps");
    },
  } as Pick<BrowserSandboxProvider, "get">;
  const access = { origin: "https://browser.example.com", managed: false };
  assert.equal(
    await publicationInspectionRuntimeOrigin(nodeId, access, provider, access.origin),
    access.origin,
  );
  assert.equal(queried, 0);
  for (const trusted of [
    "",
    "https://other.example.com",
    "http://browser.example.com",
    "https://browser.example.com/path",
  ])
    await assert.rejects(publicationInspectionRuntimeOrigin(nodeId, access, provider, trusted));
  await assert.rejects(
    publicationInspectionRuntimeOrigin(
      nodeId,
      { ...access, managed: true },
      provider,
      access.origin,
    ),
    /must_not_query_vercel_for_vps/,
  );
  assert.equal(queried, 1);
  console.log("PASS VPS restore inventory and fail-closed inspection origin checks");
}
void main();
