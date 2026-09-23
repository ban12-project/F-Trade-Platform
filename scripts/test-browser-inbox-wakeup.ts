import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import {
  authorizeBrowserSandboxStart,
  authorizeManualSandboxStart,
} from "../lib/browser-fleet/sandbox-authorization";
import { sealBrowserSandboxKey } from "../lib/browser-fleet/sandbox-credentials";
import { claimManualSandboxDispatch } from "../lib/browser-fleet/sandbox-dispatch";
import { registerBrowserSandbox } from "../lib/browser-fleet/sandbox-lifecycle";
import { enqueueDueInboxSandboxes } from "../lib/browser-fleet/sandbox-inbox-wakeup";
import type { FleetState } from "../lib/browser-fleet/policy";
import type { Database } from "../lib/db/client";
import { configuredFacebookKeyring } from "../lib/social/facebook-vault-crypto";

export async function testInboxWakeup(
  db: Database,
  input: { nodeId: string; accessKey: string; channelRef: string; accountRef: string },
) {
  const { nodeId, accessKey, channelRef, accountRef } = input;
  const previous = process.env.BROWSER_SANDBOX_ENABLED;
  const before = await db.execute(sql`SELECT document FROM browser_fleet_node WHERE id = ${nodeId}`);
  const original = before.rows[0].document as FleetState;
  process.env.BROWSER_SANDBOX_ENABLED = "1";
  try {
    await db.transaction((tx) => registerBrowserSandbox(tx, nodeId));
    await db.execute(sql`UPDATE browser_sandbox SET access_key_ciphertext =
      ${sealBrowserSandboxKey(nodeId, accessKey, configuredFacebookKeyring())}
      WHERE node_id = ${nodeId}`);
    const state = structuredClone(original);
    state.capabilities = ["interactive", "inbox"];
    state.accounts[0].pollSeconds = 900;
    state.accounts[0].nextPollAt = 0;
    state.inboxScopes = [];
    await db.execute(sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(state)}::jsonb
      WHERE id = ${nodeId}`);
    await enqueueDueInboxSandboxes(db, nodeId);
    const read = async () =>
      (await db.execute(sql`SELECT * FROM browser_sandbox WHERE node_id = ${nodeId}`)).rows[0];
    assert.equal((await read()).phase, "stopped", "unreviewed inbox cannot wake");
    const scope = [{ channelRef, accountRef, expiresAt: Date.now() + 3600000 }];
    await db.execute(sql`UPDATE browser_fleet_node SET document = jsonb_set(document,
      '{inboxScopes}', ${JSON.stringify(scope)}::jsonb) WHERE id = ${nodeId}`);
    await db.execute(sql`UPDATE social_channel_control SET circuit_status = 'paused',
      pause_reason = 'synthetic_wakeup_test' WHERE channel_ref = ${channelRef}
      AND account_ref = ${accountRef}`);
    await enqueueDueInboxSandboxes(db, nodeId);
    assert.equal((await read()).phase, "stopped", "paused inbound channel cannot wake");
    await db.execute(sql`UPDATE social_channel_control SET circuit_status = 'active',
      pause_reason = NULL WHERE channel_ref = ${channelRef} AND account_ref = ${accountRef}`);
    await Promise.all(Array.from({ length: 4 }, () => enqueueDueInboxSandboxes(db, nodeId)));
    const operation = (await read()).operation_id as string;
    assert.ok(operation, "due inbox starts a stopped Sandbox");
    assert.equal((await read()).phase, "starting");
    assert.equal(
      (await db.execute(sql`SELECT * FROM browser_sandbox_outbox WHERE node_id = ${nodeId}`))
        .rows.length,
      1,
      "concurrent schedulers create one start intent",
    );
    const authorize = () =>
      db.transaction((tx) => authorizeBrowserSandboxStart(tx, nodeId, operation));
    assert.ok(await authorize());
    assert.equal(
      await db.transaction((tx) => authorizeManualSandboxStart(tx, nodeId, operation)),
      null,
      "scheduled poll cannot masquerade as interactive demand",
    );
    await db.execute(sql`UPDATE browser_fleet_node SET document = jsonb_set(document,
      '{inboxScopes}', '[]'::jsonb) WHERE id = ${nodeId}`);
    assert.equal(await authorize(), null, "revoked review blocks credential release");
    await db.execute(sql`UPDATE browser_fleet_node SET document = jsonb_set(document,
      '{inboxScopes}', ${JSON.stringify(scope)}::jsonb) WHERE id = ${nodeId}`);
    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.transaction((tx) => claimManualSandboxDispatch(tx, nodeId, operation)),
      ),
    );
    assert.equal(claims.filter(Boolean).length, 1, "one provider claim for one poll");
    console.log("PASS due inbox cold-start: reviewed scope, channel state and one dispatch");
  } finally {
    await db.execute(sql`DELETE FROM browser_sandbox_outbox WHERE node_id = ${nodeId}`);
    await db.execute(sql`DELETE FROM browser_sandbox WHERE node_id = ${nodeId}`);
    await db.execute(sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(original)}::jsonb
      WHERE id = ${nodeId}`);
    await db.execute(sql`UPDATE social_channel_control SET circuit_status = 'active',
      pause_reason = NULL WHERE channel_ref = ${channelRef} AND account_ref = ${accountRef}`);
    if (previous === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
    else process.env.BROWSER_SANDBOX_ENABLED = previous;
  }
}
