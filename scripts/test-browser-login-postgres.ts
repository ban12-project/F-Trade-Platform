/** Synthetic owner consent -> admitted lease -> one-use credential release. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { POST } from "../app/api/browser-nodes/route";
import type { FleetState } from "../lib/browser-fleet/policy";
import { handleBrowserNodeRequest, ownerBrowserCommand } from "../lib/browser-fleet/store";
import type { Database } from "../lib/db/client";
import { auditEvent, session } from "../lib/db/schema";

export async function testBrowserLogin(
  database: Database,
  owner: { id: string; sessionId: string },
) {
  const node = await ownerBrowserCommand(
    {
      operation: "create",
      value: {
        name: "Synthetic login node",
        gatewayOrigin: "https://synthetic-login.example.invalid",
        maxBrowsers: 1,
        memoryBudgetMb: 2048,
        browserMemoryMb: 2048,
      },
    },
    owner,
  );
  assert.ok(node.nodeId && node.accessKey);
  const nodeId = node.nodeId,
    accessKey = node.accessKey;
  const channelRef = randomUUID(),
    accountRef = randomUUID();
  const username = "synthetic-login@example.invalid",
    password = "  SYNTHETIC-vault-secret  ";
  await ownerBrowserCommand(
    {
      operation: "grant",
      value: {
        nodeId,
        channelRef,
        accountRef,
        expectedEgressIp: "203.0.113.10",
        pollSeconds: 0,
        credentials: {
          loginUsername: username,
          loginPassword: password,
          proxyHost: "synthetic-proxy.example.invalid",
          proxyPort: "3128",
          proxyUsername: "",
          proxyPassword: "",
          clearLogin: false,
          clearProxy: false,
        },
      },
    },
    owner,
  );
  const state = async () => {
    const value = await database.execute(
      sql`SELECT document FROM browser_fleet_node WHERE id = ${nodeId}`,
    );
    return value.rows[0].document as FleetState;
  };
  const write = (value: FleetState) =>
    database.execute(
      sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(value)}::jsonb WHERE id = ${nodeId}`,
    );
  const accountId = (await state()).accounts[0].id;
  const identity = { installationId: randomUUID(), bootId: randomUUID() };
  const call = (value: Record<string, unknown>) =>
    handleBrowserNodeRequest(accessKey, { ...identity, ...value });
  const recover = (configured: boolean) =>
    call({
      operation: "recover",
      stoppedRunIds: [],
      capabilities: ["interactive"],
      ...(configured
        ? { loginFillScopes: [{ channelRef, accountRef, expiresAt: Date.now() + 3600000 }] }
        : {}),
    });
  const start = async () => {
    const opened = await ownerBrowserCommand({ operation: "open", nodeId, accountId }, owner);
    const claim = await call({
      operation: "claim",
      requestId: randomUUID(),
      availableMemoryMb: 4096,
      localSlots: 1,
    });
    const run = claim.run as { id: string; leaseId: string };
    assert.equal(run.id, opened.runId);
    assert.equal(JSON.stringify(claim).includes(password), false);
    const heartbeat = () =>
      call({ operation: "heartbeat", runId: run.id, leaseId: run.leaseId, ready: true });
    const authorize = (actor = owner) =>
      ownerBrowserCommand(
        { operation: "use-saved-login", nodeId, runId: run.id, confirmed: true },
        actor,
      );
    await assert.rejects(authorize, /saved_login_unavailable/);
    assert.equal((await heartbeat()).loginAuthorization, undefined);
    await assert.rejects(authorize, /saved_login_unavailable/);
    const ticket = await ownerBrowserCommand({ operation: "ticket", nodeId, runId: run.id }, owner);
    assert.ok(ticket.connection);
    await call({ operation: "admit", ticket: ticket.connection.token });
    return {
      run,
      heartbeat,
      authorize,
      finish: () =>
        call({
          operation: "finish",
          runId: run.id,
          leaseId: run.leaseId,
          outcome: "completed",
          stopped: true,
        }),
    };
  };
  await recover(false);
  const unavailable = await start();
  await assert.rejects(unavailable.authorize, /saved_login_unavailable/);
  await unavailable.finish();
  await recover(true);
  const current = await start();
  const otherSession = randomUUID();
  await database.insert(session).values({
    id: otherSession,
    token: randomUUID(),
    userId: owner.id,
    expiresAt: new Date(Date.now() + 3600000),
  });
  await assert.rejects(
    () => current.authorize({ id: owner.id, sessionId: otherSession }),
    /wrong_session/,
  );
  const consents = await Promise.allSettled(Array.from({ length: 5 }, () => current.authorize()));
  assert.equal(consents.filter((result) => result.status === "fulfilled").length, 1);
  const notice = (await current.heartbeat()).loginAuthorization as {
    id: string;
    expiresAt: number;
  };
  assert.ok(notice.id && notice.expiresAt > Date.now());
  const request = {
    operation: "claim-login",
    runId: current.run.id,
    leaseId: current.run.leaseId,
    authorizationId: notice.id,
  };
  await assert.rejects(
    () => call({ ...request, authorizationId: randomUUID() }),
    /saved_login_not_authorized/,
  );
  await assert.rejects(() => call({ ...request, leaseId: randomUUID() }), /lease_mismatch/);
  await assert.rejects(() => call({ ...request, bootId: randomUUID() }), /stale_node_process/);
  await assert.rejects(
    () => call({ ...request, installationId: randomUUID() }),
    /node_already_installed/,
  );
  const baseline = await state();
  const lastRun = (value: FleetState) => {
    const run = value.runs.at(-1);
    assert.ok(run);
    return run;
  };
  for (const mutate of [
    (value: FleetState) => {
      value.loginFillScopes = [];
    },
    (value: FleetState) => {
      const scope = value.loginFillScopes?.[0];
      assert.ok(scope);
      scope.expiresAt = Date.now() - 1;
    },
    (value: FleetState) => {
      value.accounts[0].enabled = false;
    },
    (value: FleetState) => {
      value.accounts[0].credentialVersion++;
    },
    (value: FleetState) => {
      value.accounts[0].loginCiphertext = null;
    },
    (value: FleetState) => {
      value.accounts[0].expectedEgressIp = undefined;
    },
    (value: FleetState) => {
      lastRun(value).kind = "inbox";
    },
    (value: FleetState) => {
      lastRun(value).kind = "publish";
    },
    (value: FleetState) => {
      lastRun(value).stopRequested = true;
    },
    (value: FleetState) => {
      lastRun(value).leaseUntil = Date.now() - 1;
    },
    (value: FleetState) => {
      const authorization = lastRun(value).savedLogin;
      assert.ok(authorization);
      authorization.expiresAt = Date.now() - 1;
    },
  ]) {
    const changed = structuredClone(baseline);
    mutate(changed);
    await write(changed);
    await assert.rejects(() => call(request), /saved_login_/);
    assert.equal((await state()).runs.at(-1)?.savedLogin?.claimedAt, null);
  }
  await write(baseline);
  const originalSession = await database
    .select()
    .from(session)
    .where(eq(session.id, owner.sessionId));
  await database
    .update(session)
    .set({ expiresAt: new Date(0) })
    .where(eq(session.id, owner.sessionId));
  try {
    await assert.rejects(() => call(request), /saved_login_unavailable/);
  } finally {
    await database
      .update(session)
      .set({ expiresAt: originalSession[0].expiresAt })
      .where(eq(session.id, owner.sessionId));
  }
  const binding = await database.execute(
    sql`DELETE FROM browser_fleet_binding WHERE node_id = ${nodeId} RETURNING *`,
  );
  try {
    await assert.rejects(() => call(request), /saved_login_unavailable/);
  } finally {
    const row = binding.rows[0];
    await database.execute(
      sql`INSERT INTO browser_fleet_binding (id,node_id,account_ref,channel_ref) VALUES (${row.id},${row.node_id},${row.account_ref},${row.channel_ref})`,
    );
  }
  process.env.BROWSER_FLEET_ENABLED = "1";
  const http = (value: Record<string, unknown>, key = accessKey) =>
    POST(
      new Request("https://synthetic.invalid/api/browser-nodes", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ ...identity, ...value }),
      }),
    );
  assert.equal((await http(request, "invalid")).status, 401);
  const responses = await Promise.all(Array.from({ length: 8 }, () => http(request)));
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  for (const response of responses) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    if (response.status === 200) {
      assert.deepEqual(body.credential, { username, password });
      assert.ok(body.expiresAt <= Date.now() + 30000 && body.expiresAt <= notice.expiresAt);
    } else assert.deepEqual(body, { error: "node_request_denied" });
  }
  const receipt = {
    operation: "login-result",
    runId: current.run.id,
    leaseId: current.run.leaseId,
    authorizationId: notice.id,
    outcome: "filled",
  };
  await assert.rejects(
    () => call({ ...receipt, authorizationId: randomUUID() }),
    /saved_login_result_not_authorized/,
  );
  assert.equal((await call(receipt)).replayed, false);
  assert.equal((await call(receipt)).replayed, true);
  await assert.rejects(
    () => call({ ...receipt, outcome: "unknown" }),
    /saved_login_result_conflict/,
  );
  assert.equal((await state()).accounts[0].authState, "needs_login");
  assert.equal((await current.heartbeat()).loginAuthorization, undefined);
  await assert.rejects(current.authorize, /already_requested/);
  const publicView = await call({ operation: "sync" });
  const publicJson = JSON.stringify(publicView);
  assert.equal(publicJson.includes(password), false);
  assert.equal(publicJson.includes(username), false);
  assert.equal(publicJson.includes(notice.id), false);
  const persisted = await state();
  assert.equal(JSON.stringify(persisted).includes(password), false);
  assert.equal(
    persisted.accounts[0].authState,
    "needs_login",
    "Credential release never confirms login",
  );
  assert.ok(persisted.runs.at(-1)?.savedLogin?.claimedAt);
  const audit = await database
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.subjectId, current.run.id));
  assert.equal(
    audit.filter((event) => event.action === "browser_credentials.login_released").length,
    1,
  );
  assert.equal(JSON.stringify(audit).includes(password), false);
  await current.finish();
  const refused = await start();
  await refused.authorize();
  const refusedNotice = (await refused.heartbeat()).loginAuthorization as { id: string };
  const refusedRequest = {
    runId: refused.run.id,
    leaseId: refused.run.leaseId,
    authorizationId: refusedNotice.id,
  };
  await assert.rejects(
    () => call({ operation: "login-result", ...refusedRequest, outcome: "filled" }),
    /saved_login_result_not_authorized/,
  );
  await call({ operation: "login-result", ...refusedRequest, outcome: "refused" });
  assert.equal((await refused.heartbeat()).loginAuthorization, undefined);
  await assert.rejects(
    () => call({ operation: "claim-login", ...refusedRequest }),
    /saved_login_not_authorized/,
  );
  await refused.finish();
  const lost = await start();
  await lost.authorize();
  const lostNotice = (await lost.heartbeat()).loginAuthorization as { id: string };
  const lostRequest = {
    operation: "claim-login",
    runId: lost.run.id,
    leaseId: lost.run.leaseId,
    authorizationId: lostNotice.id,
  };
  const discarded = await http(lostRequest);
  assert.equal(discarded.status, 200);
  await discarded.body?.cancel();
  assert.equal(
    (await http(lostRequest)).status,
    403,
    "Discarding the response cannot re-release a credential",
  );
  await call({
    operation: "finish",
    runId: lost.run.id,
    leaseId: lost.run.leaseId,
    stopped: true,
    outcome: "unknown",
  });
  const interrupted = (await call({ operation: "sync" })).runs as Array<{
    id: string;
    savedLoginOutcome: string | null;
  }>;
  assert.equal(interrupted.find((run) => run.id === lost.run.id)?.savedLoginOutcome, "unknown");
  assert.equal((await state()).runs.at(-1)?.savedLogin?.outcome, undefined);
  await call({ ...lostRequest, operation: "login-result", outcome: "filled" });
  const recovered = (await call({ operation: "sync" })).runs as typeof interrupted;
  assert.equal(recovered.find((run) => run.id === lost.run.id)?.savedLoginOutcome, "filled");
  assert.equal((await state()).accounts[0].authState, "needs_login");
  await ownerBrowserCommand({ operation: "revoke", nodeId }, owner);
  assert.equal((await http(lostRequest)).status, 403);
  console.log(
    "PASS saved login: owner consent, admitted session, current scope/lease, one-use concurrent HTTP release, private metadata and lost-response refusal",
  );
}
