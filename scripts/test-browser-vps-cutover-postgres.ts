import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { initialState, type Run } from "../lib/browser-fleet/policy";
import {
  applyBrowserVpsMigration,
  planBrowserVpsMigration,
} from "../lib/browser-fleet/vps-migration";

const connection = process.env.BROWSER_FLEET_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/browser_fleet_test"
)
  throw Error("dedicated_synthetic_loopback_database_required");
const pool = new Pool({ connectionString: connection });
async function fixture() {
  const nodeId = randomUUID(),
    owner = randomUUID(),
    accountId = randomUUID();
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
  state.runs.push({
    id: randomUUID(),
    kind: "publish",
    status: "unknown",
    publicationOutcome: "unknown",
  } as Run);
  const inventory = {
    nodeId,
    installationId: state.installationId,
    nodeState: { name: "synthetic-node-state", sha256: "a".repeat(64) },
    accountVolumes: [
      { name: `ftbrowser-${nodeId}-${accountId}`, nodeId, accountId, sha256: "b".repeat(64) },
    ],
    privateConfigSha256: "c".repeat(64),
    agentImage: `sha256:${"d".repeat(64)}`,
    browserImage: `sha256:${"e".repeat(64)}`,
    nativeProfiles: true,
  };
  const provider = {
    name: `ftrade-browser-${nodeId}`,
    status: "stopped",
    persistent: true,
    nodeTag: nodeId,
    snapshotId: "synthetic-snapshot",
    snapshotStatus: "created",
    snapshotExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    lastSessionId: "synthetic-session",
  };
  await pool.query('INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)', [
    owner,
    "Synthetic VPS test",
    `${owner}@example.invalid`,
    "admin",
  ]);
  await pool.query(
    "INSERT INTO browser_fleet_node(id,owner_id,name,gateway_origin,key_hash,document) VALUES($1,$2,'Synthetic VPS',NULL,'original-hash',$3::jsonb)",
    [nodeId, owner, JSON.stringify(state)],
  );
  await pool.query(
    "INSERT INTO browser_sandbox(node_id,sandbox_name,dispatch_operation_id,provider_initialized) VALUES($1,$2,$3,true)",
    [nodeId, provider.name, randomUUID()],
  );
  await pool.query(
    "INSERT INTO browser_sandbox_outbox(operation_id,node_id,workflow_run_id) VALUES($1,$2,'synthetic-completed-workflow')",
    [randomUUID(), nodeId],
  );
  const input = {
    nodeId,
    gatewayOrigin: "https://synthetic-vps.example",
    sourceInventory: inventory,
    targetInventory: inventory,
    approvedAgentImage: inventory.agentImage,
  };
  return { nodeId, state, provider, input };
}
async function main() {
  let cases = 0;
  try {
    const f = await fixture();
    const plan = await planBrowserVpsMigration(pool, f.input, async () => f.provider);
    assert.equal(
      (
        await pool.query("SELECT count(*)::int count FROM browser_sandbox WHERE node_id=$1", [
          f.nodeId,
        ])
      ).rows[0].count,
      1,
    );
    cases++;
    const tx = await pool.connect();
    let artifacts = 0;
    const deps = {
      inspect: async () => f.provider,
      allowInteractiveQuarantineRecovery: false,
      persistPrivateArtifacts: async () => {
        artifacts++;
      },
    };
    try {
      await tx.query("BEGIN");
      await assert.rejects(
        applyBrowserVpsMigration(tx, plan, {
          ...deps,
          inspect: async () => ({ ...f.provider, snapshotId: "changed" }),
        }),
        /migration_provider_changed_replan/,
      );
      await tx.query("ROLLBACK");
      assert.equal(artifacts, 0);
      cases++;
      await tx.query("BEGIN");
      await assert.rejects(
        applyBrowserVpsMigration(tx, plan, {
          ...deps,
          persistPrivateArtifacts: async () => {
            throw Error("synthetic_disk_unavailable");
          },
        }),
        /synthetic_disk_unavailable/,
      );
      await tx.query("ROLLBACK");
      assert.equal(
        (await pool.query("SELECT key_hash FROM browser_fleet_node WHERE id=$1", [f.nodeId]))
          .rows[0].key_hash,
        "original-hash",
      );
      cases++;
      await pool.query(
        "UPDATE browser_sandbox_outbox SET claim_id=$2,claim_until=now()+interval '5 minutes' WHERE node_id=$1",
        [f.nodeId, randomUUID()],
      );
      await assert.rejects(
        planBrowserVpsMigration(pool, f.input, async () => f.provider),
        /migration_outbox_pending/,
      );
      cases++;
      await pool.query(
        "UPDATE browser_sandbox_outbox SET claim_id=NULL,claim_until=NULL WHERE node_id=$1",
        [f.nodeId],
      );
      // Hold the actual node lock while a concurrent migration waits. Commit a
      // changed document first: the migration must see and reject the new demand.
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM browser_fleet_node WHERE id=$1 FOR UPDATE", [f.nodeId]);
      await tx.query("BEGIN");
      const race = applyBrowserVpsMigration(tx, plan, deps).then(
        () => null,
        (error) => error as Error,
      );
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname='browser_fleet_test' AND wait_event_type='Lock' AND query LIKE '%browser_fleet_node%' LIMIT 1",
        );
        if (rows.rowCount) {
          waiting = true;
          break;
        }
        await delay(10);
      }
      assert(waiting, "actual concurrent node lock wait observed");
      const changed = {
        ...f.state,
        runs: [...f.state.runs, { id: randomUUID(), kind: "interactive", status: "queued" }],
      };
      await blocker.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [
        f.nodeId,
        JSON.stringify(changed),
      ]);
      await blocker.query("COMMIT");
      blocker.release();
      assert.match((await race)?.message ?? "", /migration_state_changed_replan/);
      await tx.query("ROLLBACK");
      assert.equal(artifacts, 0);
      cases++;
      await assert.rejects(
        planBrowserVpsMigration(pool, f.input, async () => f.provider),
        /migration_new_or_live_demand/,
      );
      cases++;
      const quarantine = {
        ...f.state,
        runs: [
          ...f.state.runs,
          {
            id: randomUUID(),
            kind: "interactive",
            status: "quarantined",
            leaseUntil: 1,
            deadline: 1,
          },
        ],
      };
      await pool.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [
        f.nodeId,
        JSON.stringify(quarantine),
      ]);
      const second = await planBrowserVpsMigration(pool, f.input, async () => f.provider);
      await tx.query("BEGIN");
      await assert.rejects(
        applyBrowserVpsMigration(tx, second, deps),
        /migration_quarantine_recovery_not_acknowledged/,
      );
      await tx.query("ROLLBACK");
      cases++;
      let archive: unknown,
        key = "";
      await tx.query("BEGIN");
      const result = await applyBrowserVpsMigration(tx, second, {
        ...deps,
        allowInteractiveQuarantineRecovery: true,
        persistPrivateArtifacts: async (a, k) => {
          archive = a;
          key = k;
        },
      });
      await tx.query("COMMIT");
      assert.equal(result.recoveryRequired, 1);
      assert(archive);
      assert(key.startsWith(`fbn_${f.nodeId}.`));
      const row = (
        await pool.query(
          "SELECT document,key_hash,gateway_origin FROM browser_fleet_node WHERE id=$1",
          [f.nodeId],
        )
      ).rows[0];
      assert.deepEqual(row.document, quarantine);
      assert.notEqual(row.key_hash, "original-hash");
      assert.equal(row.gateway_origin, f.input.gatewayOrigin);
      assert.equal(
        (
          await pool.query("SELECT count(*)::int count FROM browser_sandbox WHERE node_id=$1", [
            f.nodeId,
          ])
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int count FROM browser_sandbox_outbox WHERE node_id=$1",
            [f.nodeId],
          )
        ).rows[0].count,
        0,
      );
      cases++;
      await tx.query("BEGIN");
      await assert.rejects(
        applyBrowserVpsMigration(tx, second, deps),
        /migration_managed_node_missing/,
      );
      await tx.query("ROLLBACK");
      cases++;
    } finally {
      await tx.query("ROLLBACK");
      tx.release();
    }
    console.log(
      `PASS ${cases} PostgreSQL VPS cutover, source drift, concurrent demand, quarantine and replay checks`,
    );
  } finally {
    await pool.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
