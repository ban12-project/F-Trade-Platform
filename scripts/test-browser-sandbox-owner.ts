import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { enqueueRun, type FleetState, initialState } from "../lib/browser-fleet/policy";
import { authorizeManualSandboxStart } from "../lib/browser-fleet/sandbox-authorization";
import { openBrowserSandboxKey } from "../lib/browser-fleet/sandbox-credentials";
import {
  claimManualSandboxDispatch,
  recordedBrowserSandboxDispatch,
} from "../lib/browser-fleet/sandbox-dispatch";
import {
  bindBrowserSandboxGateway,
  settleBrowserSandboxOperation,
} from "../lib/browser-fleet/sandbox-lifecycle";
import { monitorBrowserSandboxSession } from "../lib/browser-fleet/sandbox-monitor";
import {
  claimBrowserSandboxDelivery,
  deliverBrowserSandboxOutbox,
  enqueueManualBrowserSandboxStart,
  recordBrowserSandboxDelivery,
} from "../lib/browser-fleet/sandbox-outbox";
import type { BrowserSandboxProviderHandle } from "../lib/browser-fleet/sandbox-provider";
import { digest } from "../lib/browser-fleet/security";
import { listBrowserNodes, ownerBrowserCommand } from "../lib/browser-fleet/store";
import type { Database } from "../lib/db/client";
import {
  configuredFacebookKeyring,
  decryptFacebookCredential,
} from "../lib/social/facebook-vault-crypto";

export async function testBrowserSandboxOwner(
  database: Database,
  owner: { id: string; sessionId: string },
) {
  const previous = process.env.BROWSER_SANDBOX_ENABLED;
  const command = { operation: "create-sandbox", value: { name: "SYNTHETIC on-demand" } };
  try {
    delete process.env.BROWSER_SANDBOX_ENABLED;
    await assert.rejects(ownerBrowserCommand(command, owner), /not_enabled/);
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
    const result = await ownerBrowserCommand(command, owner);
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
    assert.ok(publicNodes.some((node) => node.id === nodeId));
    assert.ok(!JSON.stringify(publicNodes).includes(first.access_key_ciphertext));
    assert.ok(!JSON.stringify(publicNodes).includes(key));
    assert.deepEqual(await read(), first, "listing does not mutate or wake a node");
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
    await testDispatchAuthorization(database, owner);
    console.log(
      "PASS: managed node authorization, encrypted key isolation, metadata-only create/list/rotate/revoke",
    );
  } finally {
    if (previous === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
    else process.env.BROWSER_SANDBOX_ENABLED = previous;
  }
}

async function testDispatchAuthorization(
  database: Database,
  owner: { id: string; sessionId: string },
) {
  const created = await ownerBrowserCommand(
    { operation: "create-sandbox", value: { name: "SYNTHETIC dispatch" } },
    owner,
  );
  assert.ok(created.nodeId);
  const nodeId = created.nodeId;
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
  const accountId = randomUUID();
  let now = Date.now();
  state.accounts.push({
    id: accountId,
    channelRef: "synthetic",
    accountRef: randomUUID(),
    enabled: true,
    authState: "needs_login",
    credentialVersion: 1,
    loginCiphertext: null,
    proxyCiphertext: "synthetic-encrypted-proxy",
    expectedEgressIp: "203.0.113.1",
    pollSeconds: 0,
    nextPollAt: 0,
    lastCheckedAt: null,
  });
  const save = () =>
    database.execute(
      sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(state)}::jsonb WHERE id = ${nodeId}`,
    );
  await save();
  await assert.rejects(
    database.transaction(async (tx) => {
      const temporary = structuredClone(state);
      enqueueRun(
        temporary,
        {
          id: randomUUID(),
          accountId,
          kind: "interactive",
          jobRef: null,
          requestedBy: owner.id,
          authSessionId: owner.sessionId,
        },
        Date.now(),
      );
      await tx.execute(
        sql`UPDATE browser_fleet_node SET document=${JSON.stringify(temporary)}::jsonb WHERE id=${nodeId}`,
      );
      assert.ok(await enqueueManualBrowserSandboxStart(tx, nodeId));
      throw new Error("synthetic transaction rollback");
    }),
    /synthetic transaction rollback/,
  );
  const rolledBack = await database.execute(sql`SELECT n.document, s.phase,
    (SELECT count(*)::integer FROM browser_sandbox_outbox o WHERE o.node_id=n.id) AS pending
    FROM browser_fleet_node n JOIN browser_sandbox s ON s.node_id=n.id WHERE n.id=${nodeId}`);
  assert.equal(rolledBack.rows[0].phase, "stopped");
  assert.equal(rolledBack.rows[0].pending, 0);
  assert.deepEqual(rolledBack.rows[0].document, state);
  const opened = await ownerBrowserCommand({ operation: "open", nodeId, accountId }, owner);
  assert.deepEqual(Object.keys(opened), ["runId"]);
  const queued =
    await database.execute(sql`SELECT n.document, s.operation_id FROM browser_fleet_node n
    JOIN browser_sandbox s ON s.node_id=n.id WHERE n.id=${nodeId}`);
  const savedState = queued.rows[0].document as FleetState;
  state.runs = savedState.runs;
  const run = state.runs.find((item) => item.id === opened.runId);
  assert.ok(run);
  now = Date.now();
  const operationId = queued.rows[0].operation_id as string;
  assert.ok(operationId);
  await testOutboxDelivery(database, nodeId, operationId);
  const authorize = (id = operationId, time = now) =>
    database.transaction((tx) => authorizeManualSandboxStart(tx, nodeId, id, time));
  assert.ok(await authorize());
  const dispatched = await Promise.all(
    Array.from({ length: 12 }, () =>
      database.transaction((tx) => claimManualSandboxDispatch(tx, nodeId, operationId)),
    ),
  );
  const winners = dispatched.filter((value) => value !== null);
  assert.equal(winners.length, 1);
  assert.deepEqual(winners[0], { nodeId, operationId, mode: "create" });
  assert.equal(
    await database.transaction((tx) => claimManualSandboxDispatch(tx, nodeId, operationId)),
    null,
  );
  assert.equal(await authorize(randomUUID()), null);
  assert.equal(await authorize(operationId, now + 900000), null);
  run.authSessionId = randomUUID();
  await save();
  assert.equal(await authorize(), null);
  run.authSessionId = owner.sessionId;
  state.accounts[0].enabled = false;
  await save();
  assert.equal(await authorize(), null);
  state.accounts[0].enabled = true;
  state.accounts[0].credentialVersion++;
  await save();
  assert.equal(await authorize(), null);
  state.accounts[0].credentialVersion--;
  run.stopRequested = true;
  await save();
  assert.equal(await authorize(), null);
  run.stopRequested = false;
  await save();
  await database.execute(sql`UPDATE "user" SET banned = true WHERE id = ${owner.id}`);
  try {
    assert.equal(await authorize(), null);
  } finally {
    await database.execute(sql`UPDATE "user" SET banned = false WHERE id = ${owner.id}`);
  }
  assert.ok(await authorize());
  await database.transaction(async (tx) => {
    assert.equal(
      await bindBrowserSandboxGateway(
        tx,
        nodeId,
        operationId,
        "monitor-session",
        "https://gateway.example.invalid",
      ),
      true,
    );
    assert.equal(
      await settleBrowserSandboxOperation(tx, nodeId, operationId, {
        status: "running",
        sessionId: "monitor-session",
      }),
      true,
    );
  });
  assert.deepEqual(await recordedBrowserSandboxDispatch(database, nodeId, operationId), {
    status: "running",
    sessionId: "monitor-session",
  });
  assert.equal(await recordedBrowserSandboxDispatch(database, nodeId, randomUUID()), null);
  let inspections = 0,
    revocations = 0;
  await database.execute(sql`UPDATE "user" SET banned = true WHERE id = ${owner.id}`);
  try {
    assert.equal(
      await monitorBrowserSandboxSession(nodeId, "monitor-session", {
        inspect: async () => {
          const status = inspections++ === 0 ? "running" : "stopped";
          return {
            status,
            currentSession: () => ({ sessionId: "monitor-session", status }),
          } as unknown as BrowserSandboxProviderHandle;
        },
        revoke: async () => {
          revocations++;
          return "stopped";
        },
        retire: async () => {
          throw new Error("revoked owner must not use idle-only retirement");
        },
      }),
      "stopped",
    );
    assert.equal(revocations, 1);
  } finally {
    await database.execute(sql`UPDATE "user" SET banned = false WHERE id = ${owner.id}`);
  }
  const retired =
    await database.execute(sql`SELECT s.phase, s.session_id, n.gateway_origin, n.document
    FROM browser_sandbox s JOIN browser_fleet_node n ON n.id = s.node_id WHERE n.id = ${nodeId}`);
  assert.equal(retired.rows[0].phase, "stopped");
  assert.equal(await recordedBrowserSandboxDispatch(database, nodeId, operationId), null);
  assert.equal(retired.rows[0].session_id, null);
  assert.equal(retired.rows[0].gateway_origin, null);
  assert.equal((retired.rows[0].document as typeof state).runs[0].status, "queued");
  assert.equal(
    await monitorBrowserSandboxSession(nodeId, "monitor-session", {
      inspect: async () => {
        throw new Error("must not query stale session");
      },
    }),
    "superseded",
  );
  await ownerBrowserCommand({ operation: "revoke", nodeId }, owner);
  assert.equal(await authorize(), null);
  console.log(
    "PASS: manual dispatch rechecks operation, current owner/session, queued demand, expiry, account version and revocation",
  );
}

async function testOutboxDelivery(database: Database, nodeId: string, operationId: string) {
  const entries =
    await database.execute(sql`SELECT operation_id, node_id FROM browser_sandbox_outbox
    WHERE node_id=${nodeId}`);
  assert.deepEqual(entries.rows, [{ operation_id: operationId, node_id: nodeId }]);
  const claims = await Promise.all(
    Array.from({ length: 12 }, () => claimBrowserSandboxDelivery(database, nodeId)),
  );
  const winners = claims.filter((item) => item !== null);
  assert.equal(winners.length, 1);
  const first = winners[0];
  assert.equal(first.operationId, operationId);
  assert.equal(await claimBrowserSandboxDelivery(database, randomUUID()), null);
  await database.execute(sql`UPDATE browser_sandbox_outbox SET claim_until=now()-interval '1 minute'
    WHERE operation_id=${operationId}::uuid`);
  const second = await claimBrowserSandboxDelivery(database, nodeId);
  assert.ok(second);
  assert.notEqual(second.claimId, first.claimId);
  assert.equal(
    await recordBrowserSandboxDelivery(database, operationId, first.claimId, "stale"),
    false,
  );
  await database.execute(sql`UPDATE browser_sandbox_outbox SET claim_until=now()-interval '1 minute'
    WHERE operation_id=${operationId}::uuid`);
  let calls = 0;
  assert.deepEqual(
    await deliverBrowserSandboxOutbox(
      database,
      async (node, operation) => {
        assert.equal(node, nodeId);
        assert.equal(operation, operationId);
        calls++;
        throw new Error("lost workflow start response");
      },
      nodeId,
    ),
    { delivered: 0 },
  );
  assert.equal(calls, 1, "a lost response is not immediately retried");
  assert.equal(await claimBrowserSandboxDelivery(database, nodeId), null);
  await database.execute(sql`UPDATE browser_sandbox_outbox SET claim_until=now()-interval '1 minute'
    WHERE operation_id=${operationId}::uuid`);
  assert.deepEqual(
    await deliverBrowserSandboxOutbox(database, async () => "synthetic-workflow", nodeId),
    { delivered: 1 },
  );
  assert.equal(await claimBrowserSandboxDelivery(database, nodeId), null);
  console.log(
    "PASS: owner open atomically creates outbox; concurrent delivery, expired lease, stale receipt and lost response recovery",
  );
}
