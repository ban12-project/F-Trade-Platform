import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { enqueueRun, initialState } from "../lib/browser-fleet/policy";
import {
  beginBrowserSandboxStart,
  beginBrowserSandboxStop,
  registerBrowserSandbox,
  settleBrowserSandboxOperation,
} from "../lib/browser-fleet/sandbox-lifecycle";
import type { Database } from "../lib/db/client";

export async function testBrowserSandboxLifecycle(pool: Pool) {
  await pool.query(
    await readFile(new URL("../drizzle/0034_browser_sandbox.sql", import.meta.url), "utf8"),
  );
  const database = drizzle(pool) as unknown as Database;
  const nodeId = randomUUID();
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
  const accountId = randomUUID();
  state.accounts.push({
    id: accountId,
    channelRef: "synthetic",
    accountRef: randomUUID(),
    enabled: true,
    authState: "ready",
    credentialVersion: 1,
    loginCiphertext: null,
    proxyCiphertext: null,
    pollSeconds: 0,
    nextPollAt: 0,
    lastCheckedAt: null,
  });
  await pool.query(
    "INSERT INTO browser_fleet_node (id,owner_id,name,gateway_origin,key_hash,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [
      nodeId,
      "synthetic-owner",
      "sandbox",
      "https://example.invalid",
      randomUUID(),
      JSON.stringify(state),
    ],
  );
  const registered = await database.transaction((tx) => registerBrowserSandbox(tx, nodeId));
  assert.equal(registered.phase, "stopped");
  assert.equal(registered.operation_id, null);
  const start = () => database.transaction((tx) => beginBrowserSandboxStart(tx, nodeId));
  assert.equal(await start(), null, "an empty queue never starts compute");
  const run = enqueueRun(
    state,
    {
      id: randomUUID(),
      accountId,
      kind: "interactive",
      jobRef: null,
      requestedBy: "synthetic-owner",
      authSessionId: "synthetic-session",
    },
    Date.now(),
  );
  await pool.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [
    nodeId,
    JSON.stringify(state),
  ]);
  const starts = (await Promise.all(Array.from({ length: 12 }, start))).filter(
    (value) => value !== null,
  );
  assert.equal(starts.length, 1, "only one concurrent dispatcher wins");
  const operationId = starts[0].operation_id;
  assert.ok(operationId);
  const settle = (id: string, result: Parameters<typeof settleBrowserSandboxOperation>[3]) =>
    database.transaction((tx) => settleBrowserSandboxOperation(tx, nodeId, id, result));
  assert.equal(await settle(randomUUID(), { status: "running", sessionId: "stale" }), false);
  await settle(operationId, { status: "unknown" });
  assert.equal(await start(), null, "uncertain provider results must not create a replacement");
  assert.equal(await settle(operationId, { status: "running", sessionId: "session-one" }), true);
  assert.equal(
    await settle(operationId, { status: "unknown" }),
    false,
    "late callback cannot undo settlement",
  );
  const stop = (sessionId: string) =>
    database.transaction((tx) => beginBrowserSandboxStop(tx, nodeId, sessionId));
  assert.equal(await stop("old-session"), null);
  const stops = (await Promise.all(Array.from({ length: 12 }, () => stop("session-one")))).filter(
    (value) => value !== null,
  );
  assert.equal(stops.length, 1);
  assert.equal(await start(), null, "start waits until old compute has stopped");
  const secondAccountId = randomUUID();
  state.accounts.push({ ...state.accounts[0], id: secondAccountId, accountRef: randomUUID() });
  const arriving = enqueueRun(
    state,
    {
      id: randomUUID(),
      accountId: secondAccountId,
      kind: "interactive",
      jobRef: null,
      requestedBy: "synthetic-owner",
      authSessionId: "synthetic-session",
    },
    Date.now(),
  );
  await pool.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [
    nodeId,
    JSON.stringify(state),
  ]);
  const stopId = stops[0].operation_id;
  assert.ok(stopId);
  await assert.rejects(
    settle(stopId, { status: "running", sessionId: "wrong-result" }),
    /result_mismatch/,
  );
  await settle(stopId, { status: "unknown" });
  assert.equal(await start(), null);
  await settle(stopId, { status: "stopped" });
  const next = await start();
  assert.ok(next?.operation_id, "queued work survives stopping and requests another session");
  assert.notEqual(next.operation_id, operationId);
  assert.equal(
    await settle(stopId, { status: "stopped" }),
    false,
    "old stop cannot erase new start",
  );
  const saved = await pool.query("SELECT document FROM browser_fleet_node WHERE id=$1", [nodeId]);
  assert.equal(saved.rows[0].document.runs[0].id, run.id);
  assert.equal(saved.rows[0].document.runs[0].status, "queued");
  assert.notEqual(arriving.id, run.id);
  assert.ok(
    saved.rows[0].document.runs.some(
      (item: { id: string; status: string }) => item.id === arriving.id && item.status === "queued",
    ),
  );
  // Revocation prevents a later start even when work remains queued.
  await settle(next.operation_id, { status: "running", sessionId: "session-two" });
  const finalStop = await stop("session-two");
  assert.ok(finalStop?.operation_id);
  await settle(finalStop.operation_id, { status: "stopped" });
  await pool.query("UPDATE browser_fleet_node SET status='revoked' WHERE id=$1", [nodeId]);
  assert.equal(await start(), null);
  console.log(
    "PASS: durable Sandbox operations, concurrent dispatch, stale callbacks, unknown recovery, retained queue, revoked start",
  );
}
