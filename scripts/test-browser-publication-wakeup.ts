import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import {
  authorizeBrowserSandboxStart,
  authorizeManualSandboxStart,
} from "../lib/browser-fleet/sandbox-authorization";
import { sealBrowserSandboxKey } from "../lib/browser-fleet/sandbox-credentials";
import { claimManualSandboxDispatch } from "../lib/browser-fleet/sandbox-dispatch";
import { registerBrowserSandbox } from "../lib/browser-fleet/sandbox-lifecycle";
import { enqueueQueuedPublicationSandboxes } from "../lib/browser-fleet/sandbox-publication-wakeup";
import type { Database } from "../lib/db/client";
import { configuredFacebookKeyring } from "../lib/social/facebook-vault-crypto";

export async function testPublicationWakeup(
  db: Database,
  input: {
    nodeId: string;
    accessKey: string;
    actor: string;
    projectId: string;
    channelRef: string;
    accountRef: string;
    jobId: string;
    contentRef: string;
  },
) {
  const { nodeId, accessKey, actor, projectId, channelRef, accountRef, jobId, contentRef } = input;
  const previous = process.env.BROWSER_SANDBOX_ENABLED;
  process.env.BROWSER_SANDBOX_ENABLED = "1";
  try {
    await db.transaction((tx) => registerBrowserSandbox(tx, nodeId));
    await db.execute(
      sql`UPDATE browser_sandbox SET access_key_ciphertext = ${sealBrowserSandboxKey(nodeId, accessKey, configuredFacebookKeyring())} WHERE node_id = ${nodeId}`,
    );
    const scopes = [{ channelRef, accountRef, expiresAt: Date.now() + 3600000 }];
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{publicationScopes}', ${JSON.stringify(scopes)}::jsonb) WHERE id = ${nodeId}`,
    );
    await Promise.all(
      Array.from({ length: 4 }, () => enqueueQueuedPublicationSandboxes(db, nodeId)),
    );
    const read = async () =>
      (await db.execute(sql`SELECT * FROM browser_sandbox WHERE node_id = ${nodeId}`)).rows[0];
    const operation = (await read()).operation_id as string;
    assert.ok(operation);
    assert.equal((await read()).phase, "starting");
    assert.equal(
      (await db.execute(sql`SELECT * FROM browser_sandbox_outbox WHERE node_id = ${nodeId}`)).rows
        .length,
      1,
    );
    assert.equal(
      (await db.execute(sql`SELECT * FROM browser_fleet_publication WHERE job_id = ${jobId}`)).rows
        .length,
      1,
    );
    const authorize = () =>
      db.transaction((tx) => authorizeBrowserSandboxStart(tx, nodeId, operation));
    assert.ok(await authorize(), "confirmed queued publication authorizes cold start");
    assert.equal(
      await db.transaction((tx) => authorizeManualSandboxStart(tx, nodeId, operation)),
      null,
      "no fabricated manual demand",
    );
    await db.execute(
      sql`UPDATE aggregate_record SET version = version + 1 WHERE id = ${contentRef}`,
    );
    assert.equal(await authorize(), null, "stale confirmation cannot release credentials");
    await db.execute(
      sql`UPDATE aggregate_record SET version = version - 1 WHERE id = ${contentRef}`,
    );
    await db.execute(
      sql`UPDATE social_channel_control SET circuit_status = 'paused', pause_reason = 'external_result_unknown' WHERE channel_ref = ${channelRef} AND account_ref = ${accountRef}`,
    );
    assert.equal(await authorize(), null, "paused channel cannot wake");
    await db.execute(
      sql`UPDATE social_channel_control SET circuit_status = 'active', pause_reason = NULL WHERE channel_ref = ${channelRef} AND account_ref = ${accountRef}`,
    );
    await db.execute(
      sql`UPDATE workspace_project_member SET role = 'viewer' WHERE project_id = ${projectId} AND user_id = ${actor}`,
    );
    assert.equal(await authorize(), null, "revoked editor cannot wake");
    await db.execute(
      sql`UPDATE workspace_project_member SET role = 'owner' WHERE project_id = ${projectId} AND user_id = ${actor}`,
    );
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{publicationScopes}', '[]'::jsonb) WHERE id = ${nodeId}`,
    );
    assert.equal(await authorize(), null, "unreviewed scope cannot wake");
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{publicationScopes}', ${JSON.stringify(scopes.map((s) => ({ ...s, expiresAt: 1 })))}::jsonb) WHERE id = ${nodeId}`,
    );
    assert.equal(await authorize(), null, "expired scope cannot wake");
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{publicationScopes}', ${JSON.stringify(scopes)}::jsonb) WHERE id = ${nodeId}`,
    );
    assert.ok(await authorize());
    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.transaction((tx) => claimManualSandboxDispatch(tx, nodeId, operation)),
      ),
    );
    assert.equal(claims.filter(Boolean).length, 1, "only one provider dispatch claim");
    assert.equal(
      await db.transaction((tx) => claimManualSandboxDispatch(tx, nodeId, operation)),
      null,
    );
    console.log(
      "PASS publication cold-start demand: concurrent recovery, current confirmation, grant, scope and at-most-once dispatch",
    );
  } finally {
    await db.execute(sql`DELETE FROM browser_fleet_publication WHERE job_id = ${jobId}`);
    await db.execute(sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{runs}',
      COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(document->'runs') r WHERE r->>'jobRef' IS DISTINCT FROM ${jobId}), '[]'::jsonb)) WHERE id = ${nodeId}`);
    await db.execute(sql`DELETE FROM browser_sandbox_outbox WHERE node_id = ${nodeId}`);
    await db.execute(sql`DELETE FROM browser_sandbox WHERE node_id = ${nodeId}`);
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = document - 'publicationScopes' WHERE id = ${nodeId}`,
    );
    if (previous === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
    else process.env.BROWSER_SANDBOX_ENABLED = previous;
  }
}
