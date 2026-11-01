import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { enqueueRun, initialState } from "../lib/browser-fleet/policy";
import { createAccessKey, digest } from "../lib/browser-fleet/security";
import { handleBrowserNodeRequest } from "../lib/browser-fleet/store";
import { closeDatabase, getDatabase } from "../lib/db/client";
// @ts-expect-error Production gateway is a JavaScript module without declarations.
import { createGateway } from "../ops/browser-node/gateway.mjs";

async function main() {
  const connection = process.env.BROWSER_GATEWAY_TEST_DATABASE_URL;
  if (
    !connection ||
    new URL(connection).hostname !== "127.0.0.1" ||
    new URL(connection).pathname !== "/browser_gateway_test"
  )
    throw new Error("dedicated_synthetic_loopback_database_required");
  process.env.DATABASE_URL = connection;
  process.env.DATABASE_TRANSPORT = "postgres";
  const pool = new Pool({ connectionString: connection });
  const db = getDatabase();

  async function scenario(mode: string) {
    const owner = randomUUID(),
      session = randomUUID(),
      node = randomUUID(),
      account = randomUUID();
    const installationId = randomUUID(),
      bootId = randomUUID(),
      runId = randomUUID();
    const key = createAccessKey(node),
      ticket = `${runId}.${randomUUID()}`;
    const now = Date.now();
    const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
    state.installationId = installationId;
    state.bootId = bootId;
    state.capabilities = ["interactive"];
    state.accounts.push({
      id: account,
      channelRef: "synthetic",
      accountRef: account,
      enabled: true,
      authState: "ready",
      credentialVersion: 1,
      loginCiphertext: null,
      proxyCiphertext: null,
      pollSeconds: 0,
      nextPollAt: 0,
      lastCheckedAt: null,
    });
    const run = enqueueRun(
      state,
      {
        id: runId,
        accountId: account,
        kind: "interactive",
        jobRef: null,
        requestedBy: owner,
        authSessionId: session,
      },
      now,
    );
    Object.assign(run, {
      status: "running",
      leaseId: randomUUID(),
      leaseUntil: now + 60_000,
      deadline: now + 120_000,
      ticketHash: digest(ticket),
      connectBefore: now + 30_000,
    });
    let upgrades = 0;
    const sockets = new Set<import("node:stream").Duplex>();
    const upstream = http.createServer();
    upstream.on("upgrade", (request, socket) => {
      upgrades++;
      sockets.add(socket);
      socket.on("error", () => {});
      const accept = createHash("sha1")
        .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const slot = {
      run: { id: runId },
      ready: true,
      stopping: false,
      expiresAt: now + 60_000,
      gatewayOrigin: "https://browser.example",
      vncPassword: "synthetic",
      vncPort: (upstream.address() as import("node:net").AddressInfo).port,
    };
    const gateway = createGateway({
      appOrigin: "https://app.example",
      slots: new Map([[runId, slot]]),
      port: 0,
      nodeCall: async (operation: string, input: object) =>
        handleBrowserNodeRequest(key, { installationId, bootId, operation, ...input }),
    });
    await once(gateway.server, "listening");
    const port = (gateway.server.address() as import("node:net").AddressInfo).port;
    try {
      await pool.query('INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)', [
        owner,
        "Synthetic gateway",
        `${owner}@example.invalid`,
        "admin",
      ]);
      await pool.query('INSERT INTO "session"(id,expires_at,token,user_id) VALUES($1,$2,$3,$4)', [
        session,
        new Date(now + 120_000),
        randomUUID(),
        owner,
      ]);
      if (mode === "lease-expired") run.leaseUntil = now - 1;
      if (mode === "ticket-expired") run.connectBefore = now - 1;
      if (mode === "stop-requested") run.stopRequested = true;
      await pool.query(
        "INSERT INTO browser_fleet_node(id,owner_id,name,gateway_origin,key_hash,document) VALUES($1,$2,$3,$4,$5,$6)",
        [node, owner, "synthetic", slot.gatewayOrigin, digest(key), JSON.stringify(state)],
      );
      if (mode === "session-expired")
        await pool.query('UPDATE "session" SET expires_at=$1 WHERE id=$2', [
          new Date(now - 1),
          session,
        ]);
      if (mode === "session-deleted")
        await pool.query('DELETE FROM "session" WHERE id=$1', [session]);
      if (mode === "owner-banned")
        await pool.query('UPDATE "user" SET banned=true WHERE id=$1', [owner]);
      if (mode === "owner-demoted")
        await pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ["user", owner]);
      if (mode === "node-revoked")
        await pool.query("UPDATE browser_fleet_node SET status='revoked' WHERE id=$1", [node]);
      if (mode === "key-rotated")
        await pool.query("UPDATE browser_fleet_node SET key_hash=$1 WHERE id=$2", [
          digest(createAccessKey(node)),
          node,
        ]);
      const before = (
        await pool.query("SELECT document FROM browser_fleet_node WHERE id=$1", [node])
      ).rows[0].document;
      const admit = () =>
        fetch(`http://127.0.0.1:${port}/admit`, {
          method: "POST",
          headers: { Origin: slot.gatewayOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ ticket }),
          signal: AbortSignal.timeout(5000),
        });
      const responses = await Promise.all(
        Array.from({ length: mode === "concurrent" ? 8 : 1 }, admit),
      );
      const accepted = responses.filter((response) => response.status === 200);
      assert.equal(accepted.length, mode === "concurrent" ? 1 : 0, mode);
      assert.ok(responses.every((response) => response.status === 200 || response.status === 403));
      const audit = await pool.query(
        "SELECT count(*)::int AS count FROM audit_event WHERE subject_id=$1 AND action='browser_interactive.connected'",
        [runId],
      );
      assert.equal(audit.rows[0].count, accepted.length);
      const after = (
        await pool.query("SELECT document FROM browser_fleet_node WHERE id=$1", [node])
      ).rows[0].document;
      if (accepted.length) {
        assert.equal(after.runs[0].ticketHash, null);
        assert.equal(after.runs[0].ticketUsed, true);
        const capability = await accepted[0].json();
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          path: capability.websocket,
          headers: {
            Origin: slot.gatewayOrigin,
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": Buffer.alloc(16, 7).toString("base64"),
          },
        });
        const connected = once(req, "upgrade", { signal: AbortSignal.timeout(5000) });
        req.end();
        const [, socket] = await connected;
        assert.equal(upgrades, 1);
        socket.destroy();
        assert.equal(
          (await admit()).status,
          403,
          "consumed ticket cannot mint a second capability",
        );
      } else {
        assert.deepEqual(
          after,
          before,
          "denied broker transaction must not consume the ticket or mutate the run",
        );
        assert.equal(upgrades, 0);
      }
      for (const response of responses) if (!response.bodyUsed) await response.body?.cancel();
      console.log(`PASS actual PostgreSQL broker + HTTP gateway: ${mode}`);
    } finally {
      gateway.close();
      gateway.server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      upstream.close();
      upstream.closeAllConnections();
      // Append-only audit remains in this dedicated synthetic database until it is dropped.
      await pool.query("DELETE FROM browser_fleet_node WHERE id=$1", [node]);
      await pool.query('DELETE FROM "session" WHERE user_id=$1', [owner]);
      await pool.query('DELETE FROM "user" WHERE id=$1', [owner]);
    }
  }
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "./drizzle",
    });
    for (const mode of [
      "concurrent",
      "session-expired",
      "session-deleted",
      "owner-banned",
      "owner-demoted",
      "node-revoked",
      "key-rotated",
      "lease-expired",
      "ticket-expired",
      "stop-requested",
    ])
      await scenario(mode);
  } finally {
    await pool.end();
    await closeDatabase();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
