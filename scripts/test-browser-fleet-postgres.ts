import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { claimRun, enqueueRun, initialState } from "../lib/browser-fleet/policy";

async function main() {
  const connectionString = process.env.BROWSER_FLEET_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("BROWSER_FLEET_TEST_DATABASE_URL is required");
  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("browser_fleet_test")) throw new Error("Only a dedicated local test database is permitted");
  const namespace = `browser_fleet_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, options: `-c search_path=${namespace}`, max: 16 });
  try {
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await pool.query('CREATE TABLE "user" (id text PRIMARY KEY)');
    await pool.query(await readFile(new URL("../drizzle/0028_browser_fleet.sql", import.meta.url), "utf8"));
    await pool.query('INSERT INTO "user" (id) VALUES ($1)', ["synthetic-owner"]);
    const state = initialState({ maxBrowsers: 2, memoryBudgetMb: 4096, browserMemoryMb: 2048 });
    state.capabilities = ["interactive"];
    for (let i = 0; i < 12; i++) {
      const accountId = randomUUID();
      state.accounts.push({ id: accountId, channelRef: "synthetic", accountRef: accountId, enabled: true, authState: "ready", credentialVersion: 1,
        loginCiphertext: null, proxyCiphertext: null, pollSeconds: 0, nextPollAt: 0, lastCheckedAt: null });
      enqueueRun(state, { id: randomUUID(), accountId, kind: "interactive", jobRef: null, requestedBy: "synthetic-owner", authSessionId: null }, 1000);
    }
    const nodeId = randomUUID();
    const insert = 'INSERT INTO browser_fleet_node (id,owner_id,name,gateway_origin,key_hash,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)';
    await pool.query(insert, [nodeId, "synthetic-owner", "node-a", "https://browser.example", "synthetic-hash-a", JSON.stringify(state)]);
    const claims = await Promise.all(Array.from({ length: 12 }, async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT document FROM browser_fleet_node WHERE id=$1 FOR UPDATE", [nodeId]);
        const document = rows[0].document;
        const run = claimRun(document, { requestId: randomUUID(), leaseId: randomUUID(), availableMemoryMb: 8192, localSlots: 8 }, 1001);
        await client.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [nodeId, JSON.stringify(document)]);
        await client.query("COMMIT");
        return run?.id;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }));
    assert.equal(claims.filter(Boolean).length, 2);
    assert.equal(new Set(claims.filter(Boolean)).size, 2);
    const otherNode = randomUUID();
    await pool.query(insert, [otherNode, "synthetic-owner", "node-b", "https://browser-b.example", "synthetic-hash-b", JSON.stringify(initialState(state.limits))]);
    await pool.query("INSERT INTO browser_fleet_binding (id,node_id,account_ref,channel_ref) VALUES ($1,$2,$3,$4)", [randomUUID(), nodeId, "synthetic-account", "facebook"]);
    await assert.rejects(pool.query("INSERT INTO browser_fleet_binding (id,node_id,account_ref,channel_ref) VALUES ($1,$2,$3,$4)", [randomUUID(), otherNode, "synthetic-account", "facebook"]), (error: unknown) => (error as { code?: string }).code === "23505");
    await assert.rejects(pool.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [nodeId, JSON.stringify({ version: 2 })]), (error: unknown) => (error as { code?: string }).code === "23514");
    console.log("PASS: custom migration, 12 simultaneous claims / 2 slots, unique account binding, document version constraint");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
  }
}
main().catch(() => { console.error("Browser fleet PostgreSQL test failed"); process.exitCode = 1; });
