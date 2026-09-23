/** Actual production broker on a dedicated migrated loopback database. Synthetic
 * principals only. The caller must separately prove browser and gateway input. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  handleBrowserNodeRequest,
  listBrowserNodes,
  ownerBrowserCommand,
} from "../lib/browser-fleet/store";
import { closeDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";

type RunIdentity = { id: string; accountId: string; leaseId: string };
export async function createCandidateBroker(gatewayOrigin: string) {
  const connectionString = process.env.BROWSER_FLEET_TEST_DATABASE_URL;
  assert.ok(connectionString, "Dedicated acceptance database required");
  const address = new URL(connectionString);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(address.hostname));
  assert.equal(address.pathname, "/browser_fleet_test", "Refuse non-test database");
  process.env.DATABASE_URL = connectionString;
  process.env.DATABASE_TRANSPORT = "postgres";
  process.env.FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID = "synthetic";
  process.env.FACEBOOK_CREDENTIAL_KEYS_JSON = JSON.stringify({
    synthetic: Buffer.alloc(32, 3).toString("base64"),
  });
  const pool = new Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  const owner = { id: randomUUID(), sessionId: randomUUID() };
  const outsider = { id: randomUUID(), sessionId: randomUUID() };
  const anotherSession = { id: owner.id, sessionId: randomUUID() };
  const checks: string[] = [];
  let nodeId: string | undefined;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (nodeId) {
        await pool.query("DELETE FROM browser_fleet_binding WHERE node_id=$1", [nodeId]);
        await pool.query("DELETE FROM browser_fleet_node WHERE id=$1", [nodeId]);
      }
      await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [[owner.id, outsider.id]]);
    } finally {
      await closeDatabase();
      await pool.end();
    }
  }
  try {
    await migrate(db, {
      migrationsFolder: join(fileURLToPath(new URL("..", import.meta.url)), "drizzle"),
    });
    for (const actor of [owner, outsider]) {
      await db.insert(schema.user).values({
        id: actor.id,
        name: "Synthetic candidate reviewer",
        email: `${actor.id}@example.invalid`,
        role: "admin",
      });
    }
    for (const actor of [owner, outsider, anotherSession]) {
      await db.insert(schema.session).values({
        id: actor.sessionId,
        token: randomUUID(),
        userId: actor.id,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
    const created = await ownerBrowserCommand(
      {
        operation: "create",
        value: {
          name: "Synthetic candidate gateway",
          gatewayOrigin,
          maxBrowsers: 1,
          memoryBudgetMb: 2048,
          browserMemoryMb: 2048,
        },
      },
      owner,
    );
    assert.ok(created.nodeId && created.accessKey);
    nodeId = created.nodeId;
    const key = created.accessKey;
    await ownerBrowserCommand(
      {
        operation: "grant",
        value: {
          nodeId,
          channelRef: "synthetic-facebook",
          accountRef: randomUUID(),
          expectedEgressIp: "203.0.113.10",
          pollSeconds: 0,
          credentials: {
            loginUsername: "",
            loginPassword: "",
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
    const node = (await listBrowserNodes(owner.id)).find((n) => n.id === nodeId);
    assert.ok(node);
    assert.equal(node.accounts.length, 1);
    await ownerBrowserCommand({ operation: "open", nodeId, accountId: node.accounts[0].id }, owner);
    const identity = { installationId: randomUUID(), bootId: randomUUID() };
    const call = (operation: string, input: Record<string, unknown> = {}) =>
      handleBrowserNodeRequest(key, { ...identity, ...input, operation });
    await call("sync");
    await call("recover", { stoppedRunIds: [], capabilities: ["interactive"] });
    const claim = (await call("claim", {
      requestId: randomUUID(),
      localSlots: 1,
      availableMemoryMb: 2048,
    })) as { run: RunIdentity | null };
    assert.ok(claim.run);
    const run = claim.run;
    checks.push("full migrations and actual owner/node claim created an isolated synthetic run");
    const ticketCommand = { operation: "ticket", nodeId, runId: run.id };
    async function issue() {
      const result = await ownerBrowserCommand(ticketCommand, owner);
      assert.ok(result.connection);
      return result.connection.token;
    }
    return {
      run,
      nodeId,
      checks,
      close,
      async ready() {
        const result = await call("heartbeat", {
          runId: run.id,
          leaseId: run.leaseId,
          ready: true,
        });
        assert.equal(result.active, true);
        return result;
      },
      issue,
      // The gateway uses the real node key and installation binding here.
      async nodeCall(operation: string, input: Record<string, unknown>) {
        assert.equal(operation, "admit");
        return call(operation, input);
      },
      async assertOwnerGuards() {
        await assert.rejects(ownerBrowserCommand(ticketCommand, outsider), /forbidden/);
        await assert.rejects(
          ownerBrowserCommand(ticketCommand, anotherSession),
          /browser_not_connectable/,
        );
        await assert.rejects(
          handleBrowserNodeRequest(key, {
            ...identity,
            installationId: randomUUID(),
            operation: "sync",
          }),
          /already_installed/,
        );
        checks.push(
          "actual broker rejects another owner, another owner session and another node installation",
        );
      },
      async assertExpiredAdmissions(send: (ticket: string) => Promise<number>) {
        const token = await issue();
        const saved = (
          await pool.query("SELECT document FROM browser_fleet_node WHERE id=$1", [nodeId])
        ).rows[0].document;
        for (const invalid of ["expired_ticket", "expired_lease", "missing_session"]) {
          const document = structuredClone(saved);
          const target = document.runs.find((entry: { id: string }) => entry.id === run.id);
          assert.ok(target);
          if (invalid === "expired_ticket") target.connectBefore = 0;
          if (invalid === "expired_lease") target.leaseUntil = 0;
          if (invalid === "missing_session") target.authSessionId = randomUUID();
          await pool.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [
            nodeId,
            JSON.stringify(document),
          ]);
          try {
            assert.equal(await send(token), 403, invalid);
          } finally {
            await pool.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [
              nodeId,
              JSON.stringify(saved),
            ]);
          }
        }
        checks.push(
          "admission rejects expired ticket, expired run lease and missing owner session",
        );
      },
      async assertReplay(token: string, send: (ticket: string) => Promise<number>) {
        assert.equal(await send(token), 403);
        checks.push("consumed production-broker ticket cannot replay");
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Broker setup and cleanup failed");
    }
    throw error;
  }
}
