import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { initialState } from "../lib/browser-fleet/policy";
import { authorizeManualSandboxStart } from "../lib/browser-fleet/sandbox-authorization";
import {
  openBrowserSandboxKey,
  sealBrowserSandboxKey,
} from "../lib/browser-fleet/sandbox-credentials";
import { claimManualSandboxDispatch } from "../lib/browser-fleet/sandbox-dispatch";
import { registerBrowserSandbox } from "../lib/browser-fleet/sandbox-lifecycle";
import { enqueueManualBrowserSandboxStart } from "../lib/browser-fleet/sandbox-outbox";
import { createAccessKey, digest } from "../lib/browser-fleet/security";
import { listBrowserNodes, ownerBrowserCommand } from "../lib/browser-fleet/store";
import type { Database } from "../lib/db/client";
import { user } from "../lib/db/schema";
import {
  configuredFacebookKeyring,
  decryptFacebookCredential,
} from "../lib/social/facebook-vault-crypto";

/** Seed historical managed metadata directly; production can no longer create it. */
async function legacyManagedFixture(database: Database, owner: { id: string }, name: string) {
  const nodeId = randomUUID();
  const key = createAccessKey(nodeId);
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
  const ciphertext = sealBrowserSandboxKey(nodeId, key, configuredFacebookKeyring());
  await database.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO browser_fleet_node (id,owner_id,name,key_hash,document)
      VALUES (${nodeId},${owner.id},${name},${digest(key)},${JSON.stringify(state)}::jsonb)`);
    await registerBrowserSandbox(tx, nodeId);
    await tx.execute(
      sql`UPDATE browser_sandbox SET access_key_ciphertext=${ciphertext} WHERE node_id=${nodeId}`,
    );
  });
  return { nodeId };
}

export async function testBrowserSandboxOwner(
  database: Database,
  owner: { id: string; sessionId: string },
) {
  const previous = process.env.BROWSER_SANDBOX_ENABLED;
  const command = { operation: "create-sandbox", value: { name: "SYNTHETIC on-demand" } };
  try {
    delete process.env.BROWSER_SANDBOX_ENABLED;
    await assert.rejects(ownerBrowserCommand(command, owner), /vercel_sandbox_retired_use_vps/);
    process.env.BROWSER_SANDBOX_ENABLED = "1";
    await assert.rejects(
      ownerBrowserCommand(command, { ...owner, sessionId: randomUUID() }),
      /session_expired/,
    );
    await assert.rejects(
      ownerBrowserCommand(
        { ...command, value: { ...command.value, gatewayOrigin: "https://example.invalid" } },
        owner,
      ),
    );
    const before = await listBrowserNodes(owner.id);
    await assert.rejects(ownerBrowserCommand(command, owner), /vercel_sandbox_retired_use_vps/);
    assert.deepEqual(
      await listBrowserNodes(owner.id),
      before,
      "retired creation makes no database changes",
    );
    const result = await legacyManagedFixture(database, owner, command.value.name);
    assert.ok(result.nodeId);
    assert.deepEqual(Object.keys(result), ["nodeId"], "managed keys never go to the page");
    const nodeId = result.nodeId;
    const read = async () => {
      const rows = await database.execute(sql`SELECT n.key_hash, n.gateway_origin, n.status,
        s.access_key_ciphertext, s.phase, s.operation_id FROM browser_fleet_node n
        JOIN browser_sandbox s ON s.node_id = n.id WHERE n.id = ${nodeId}`);
      return rows.rows[0] as {
        key_hash: string;
        gateway_origin: string | null;
        status: string;
        access_key_ciphertext: string | null;
        phase: string;
        operation_id: string | null;
      };
    };
    const first = await read();
    assert.ok(first.access_key_ciphertext);
    const ciphertext = first.access_key_ciphertext;
    const ring = configuredFacebookKeyring();
    const key = openBrowserSandboxKey(nodeId, first.access_key_ciphertext, ring);
    assert.equal(digest(key), first.key_hash);
    assert.ok(!first.access_key_ciphertext.includes(key));
    assert.equal(first.gateway_origin, null);
    assert.equal(first.phase, "stopped");
    assert.equal(first.operation_id, null);
    assert.throws(() => openBrowserSandboxKey(randomUUID(), ciphertext, ring));
    assert.throws(() =>
      decryptFacebookCredential(
        ciphertext,
        { channelRef: "browser-sandbox", accountRef: nodeId },
        "login",
        ring,
      ),
    );
    const publicNodes = await listBrowserNodes(owner.id);
    const managed = publicNodes.find((node) => node.id === nodeId);
    assert.equal(managed?.sandbox?.phase, "stopped");
    assert.ok(Number.isFinite(managed?.sandbox?.updatedAt));
    assert.deepEqual(Object.keys(managed?.sandbox ?? {}).sort(), ["phase", "updatedAt"]);
    assert.ok(!JSON.stringify(publicNodes).includes(first.access_key_ciphertext));
    assert.ok(!JSON.stringify(publicNodes).includes(key));
    assert.deepEqual(await read(), first, "listing does not mutate or wake a node");
    await testListedSandboxPhases(database, owner, nodeId);
    const rotated = await ownerBrowserCommand({ operation: "rotate", nodeId }, owner);
    assert.equal(rotated.accessKey, undefined);
    const second = await read();
    assert.ok(second.access_key_ciphertext);
    assert.notEqual(second.key_hash, first.key_hash);
    assert.equal(
      digest(openBrowserSandboxKey(nodeId, second.access_key_ciphertext, ring)),
      second.key_hash,
    );
    assert.equal(second.phase, "stopped");
    await ownerBrowserCommand({ operation: "revoke", nodeId }, owner);
    const revoked = await read();
    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.access_key_ciphertext, null);
    assert.equal(revoked.phase, "stopped");
    await testRetiredDispatch(database, owner);
    console.log(
      "PASS: retired creation, historical key isolation and metadata-only list/rotate/revoke",
    );
  } finally {
    if (previous === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
    else process.env.BROWSER_SANDBOX_ENABLED = previous;
  }
}

async function testRetiredDispatch(database: Database, owner: { id: string; sessionId: string }) {
  for (const scenario of ["unclaimed", "claimed", "bound"] as const) {
    const { nodeId } = await legacyManagedFixture(database, owner, `SYNTHETIC retired ${scenario}`);
    const operationId = randomUUID();
    await database.execute(sql`UPDATE browser_sandbox SET phase='starting', operation_kind='start',
      operation_id=${operationId}::uuid,
      dispatch_operation_id=${scenario === "unclaimed" ? null : operationId}::uuid,
      provider_initialized=${scenario !== "unclaimed"},
      session_id=${scenario === "bound" ? "synthetic-captured-session" : null}
      WHERE node_id=${nodeId}`);
    const before = (
      await database.execute(sql`SELECT * FROM browser_sandbox WHERE node_id=${nodeId}`)
    ).rows[0];
    assert.equal(
      await database.transaction((tx) => authorizeManualSandboxStart(tx, nodeId, operationId)),
      null,
    );
    const claims = await Promise.all(
      Array.from({ length: 6 }, () =>
        database.transaction((tx) => claimManualSandboxDispatch(tx, nodeId, operationId)),
      ),
    );
    assert.ok(
      claims.every((claim) => claim === null),
      "no new or resumed provider claim after retirement",
    );
    const after = (
      await database.execute(sql`SELECT * FROM browser_sandbox WHERE node_id=${nodeId}`)
    ).rows[0];
    if (scenario === "unclaimed") {
      assert.equal(after.phase, "stopped");
      assert.equal(after.operation_id, null);
      assert.equal(
        await database.transaction((tx) => enqueueManualBrowserSandboxStart(tx, nodeId)),
        null,
      );
      assert.equal(
        (await database.execute(sql`SELECT * FROM browser_sandbox_outbox WHERE node_id=${nodeId}`))
          .rows.length,
        0,
      );
    } else {
      assert.deepEqual(
        after,
        before,
        "retirement never erases a possibly running legacy session or uncertain claim",
      );
    }
  }
  console.log(
    "PASS: permanent retirement rejects concurrent dispatch while retaining uncertain legacy claims",
  );
}

async function testListedSandboxPhases(
  database: Database,
  owner: { id: string; sessionId: string },
  nodeId: string,
) {
  const outsiderId = randomUUID();
  await database.insert(user).values({
    id: outsiderId,
    name: "SYNTHETIC outsider",
    email: `${outsiderId}@example.invalid`,
    role: "admin",
  });
  try {
    assert.deepEqual(
      await listBrowserNodes(outsiderId),
      [],
      "another admin cannot list this owner's nodes",
    );
    await database.execute(sql`UPDATE "user" SET banned=true WHERE id=${outsiderId}`);
    await assert.rejects(listBrowserNodes(outsiderId), /owner_revoked/);
    await database.execute(
      sql`UPDATE "user" SET banned=false, role='viewer' WHERE id=${outsiderId}`,
    );
    await assert.rejects(listBrowserNodes(outsiderId), /owner_revoked/);
  } finally {
    await database.execute(sql`DELETE FROM "user" WHERE id=${outsiderId}`);
  }
  const operationId = randomUUID();
  for (const phase of ["starting", "running", "stopping", "unknown", "stopped"] as const) {
    const kind =
      phase === "stopping" ? "stop" : ["starting", "unknown"].includes(phase) ? "start" : null;
    await database.execute(sql`UPDATE browser_sandbox SET phase=${phase},
      operation_kind=${kind}, operation_id=${kind ? operationId : null}::uuid,
      session_id=${["running", "stopping"].includes(phase) ? "synthetic-provider-session" : null},
      updated_at='2026-09-01T00:00:00Z' WHERE node_id=${nodeId}`);
    const before = (
      await database.execute(sql`SELECT * FROM browser_sandbox WHERE node_id=${nodeId}`)
    ).rows;
    // Disabled provisioning must not hide existing lifecycle evidence.
    process.env.BROWSER_SANDBOX_ENABLED = "0";
    const listed = await listBrowserNodes(owner.id);
    process.env.BROWSER_SANDBOX_ENABLED = "1";
    const managed = listed.find((node) => node.id === nodeId);
    assert.deepEqual(managed?.sandbox, { phase, updatedAt: Date.parse("2026-09-01T00:00:00Z") });
    assert.ok(!JSON.stringify(listed).includes(operationId));
    assert.ok(!JSON.stringify(listed).includes("synthetic-provider-session"));
    assert.deepEqual(
      (await database.execute(sql`SELECT * FROM browser_sandbox WHERE node_id=${nodeId}`)).rows,
      before,
    );
  }
  const external = await ownerBrowserCommand(
    {
      operation: "create",
      value: {
        name: "SYNTHETIC self-managed",
        gatewayOrigin: "https://example.invalid",
        maxBrowsers: 1,
        memoryBudgetMb: 2048,
        browserMemoryMb: 2048,
      },
    },
    owner,
  );
  assert.equal(
    (await listBrowserNodes(owner.id)).find((node) => node.id === external.nodeId)?.sandbox,
    null,
  );
  console.log(
    "PASS: owner list distinguishes managed lifecycle from self-managed nodes without provider identifiers or mutations, including while disabled",
  );
}
