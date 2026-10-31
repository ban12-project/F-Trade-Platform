/** Explicit operator tool. No env-file discovery and no provider mutations.
 * plan: --node-id UUID --gateway HTTPS --source-inventory FILE --target-inventory FILE --approved-agent-image sha256:... --output FILE
 * apply: --apply --plan FILE --key-output FILE --rollback-output FILE [--allow-interactive-quarantine-recovery]
 * verify: --verify --rollback FILE (after the Agent's normal recover)
 */
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Sandbox, Snapshot } from "@vercel/sandbox";
import { Pool } from "pg";
import type { FleetState } from "../lib/browser-fleet/policy";
import {
  applyBrowserVpsMigration,
  browserVpsMigrationPlanSchema,
  migrationHash,
  planBrowserVpsMigration,
} from "../lib/browser-fleet/vps-migration";
import { assertBrowserVpsCutoverDrained } from "../lib/browser-fleet/vps-migration-contract";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean" },
    verify: { type: "boolean" },
    plan: { type: "string" },
    rollback: { type: "string" },
    "node-id": { type: "string" },
    gateway: { type: "string" },
    "source-inventory": { type: "string" },
    "target-inventory": { type: "string" },
    "approved-agent-image": { type: "string" },
    output: { type: "string" },
    "key-output": { type: "string" },
    "rollback-output": { type: "string" },
    "allow-interactive-quarantine-recovery": { type: "boolean" },
  },
  strict: true,
});
function required(name: keyof typeof values) {
  const value = values[name];
  if (typeof value !== "string" || !value) throw Error(`missing_${name}`);
  return value;
}
async function privateJson(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw Error("private_receipt_permissions_required");
  return JSON.parse(await readFile(path, "utf8"));
}
async function privateWrite(file: string, value: string) {
  const path = resolve(file),
    parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0)
    throw Error("private_output_directory_required");
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(dirname(path), constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function inspect(nodeId: string) {
  const token = process.env.VERCEL_TOKEN,
    teamId = process.env.VERCEL_TEAM_ID,
    projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !teamId || !projectId) throw Error("explicit_vercel_credentials_required");
  const credentials = { token, teamId, projectId };
  const box = await Sandbox.get({
    ...credentials,
    name: `ftrade-browser-${nodeId}`,
    resume: false,
    signal: AbortSignal.timeout(15000),
  });
  if (!box.currentSnapshotId) throw Error("migration_source_snapshot_missing");
  const snapshot = await Snapshot.get({
    ...credentials,
    snapshotId: box.currentSnapshotId,
    signal: AbortSignal.timeout(15000),
  });
  if (!snapshot.expiresAt) throw Error("migration_source_retention_unknown");
  return {
    name: box.name,
    status: box.status,
    persistent: box.persistent,
    nodeTag: box.tags?.["ftrade-node"],
    snapshotId: box.currentSnapshotId,
    snapshotStatus: snapshot.status,
    snapshotExpiresAt: snapshot.expiresAt.toISOString(),
    lastSessionId: box.currentSession().sessionId,
  };
}
async function main() {
  if (values.apply && values.verify) throw Error("mutually_exclusive_modes");
  if (!process.env.DATABASE_URL) throw Error("explicit_database_url_required");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 15000,
  });
  const db = await pool.connect();
  try {
    if (values.verify) {
      const archive = await privateJson(required("rollback"));
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const plan = browserVpsMigrationPlanSchema.parse(archive.plan);
      const row = (
        await db.query("SELECT to_jsonb(n) row FROM browser_fleet_node n WHERE id=$1", [
          plan.nodeId,
        ])
      ).rows[0]?.row;
      if (!row || row.gateway_origin !== plan.gatewayOrigin || row.key_hash !== archive.newKeyHash)
        throw Error("migration_target_identity_unconfirmed");
      const remaining = await db.query(
        "SELECT (SELECT count(*) FROM browser_sandbox WHERE node_id=$1)::int managed,(SELECT count(*) FROM browser_sandbox_outbox WHERE node_id=$1)::int outbox",
        [plan.nodeId],
      );
      if (remaining.rows[0].managed || remaining.rows[0].outbox)
        throw Error("migration_managed_state_remains");
      const state = row.document as FleetState;
      assertBrowserVpsCutoverDrained(state);
      if (state.installationId !== archive.previous.node.document.installationId)
        throw Error("migration_installation_changed");
      const prior = archive.previous.node.document as FleetState;
      if (
        !state.bootId ||
        state.bootId === prior.bootId ||
        state.lastSeenAt < Date.parse(archive.createdAt)
      )
        throw Error("migration_agent_recovery_not_observed");
      if (
        migrationHash(state.accounts.map((a) => a.id).sort()) !==
          migrationHash(prior.accounts.map((a) => a.id).sort()) ||
        migrationHash(state.limits) !== migrationHash(prior.limits)
      )
        throw Error("migration_broker_configuration_changed");
      for (const runId of plan.quarantinedInteractiveRunIds) {
        const run = state.runs.find((r) => r.id === runId);
        if (run?.kind !== "interactive" || run.status !== "failed" || run.failure !== "failed")
          throw Error("migration_quarantine_recovery_unconfirmed");
      }
      for (const run of prior.runs.filter((r) => r.status === "unknown")) {
        if (migrationHash(state.runs.find((r) => r.id === run.id)) !== migrationHash(run))
          throw Error("migration_unknown_history_changed");
      }
      const provider = await inspect(plan.nodeId);
      if (provider.status !== "stopped" || provider.snapshotId !== plan.provider.snapshotId)
        throw Error("migration_source_no_longer_stopped");
      await db.query("COMMIT");
      console.log(
        JSON.stringify({
          verified: true,
          nodeId: plan.nodeId,
          sourceStopped: true,
          unknownRunsPreserved: prior.runs.filter((r) => r.status === "unknown").length,
        }),
      );
    } else if (values.apply) {
      const plan = browserVpsMigrationPlanSchema.parse(await privateJson(required("plan")));
      const keyOutput = required("key-output"),
        rollbackOutput = required("rollback-output");
      await db.query("BEGIN");
      try {
        const result = await applyBrowserVpsMigration(db, plan, {
          inspect: () => inspect(plan.nodeId),
          allowInteractiveQuarantineRecovery:
            values["allow-interactive-quarantine-recovery"] === true,
          persistPrivateArtifacts: async (archive, key) => {
            await privateWrite(rollbackOutput, `${JSON.stringify(archive, null, 2)}\n`);
            await privateWrite(keyOutput, `${key}\n`);
          },
        });
        await db.query("COMMIT");
        console.log(
          JSON.stringify({
            ...result,
            committed: true,
            next: "stage private key, start VPS Agent, then --verify; do not retry ambiguous commits",
          }),
        );
      } catch (error) {
        await db.query("ROLLBACK").catch(() => {});
        throw error;
      }
    } else {
      // Consistent read-only database snapshot; apply locks and revalidates it.
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const nodeId = required("node-id");
      const plan = await planBrowserVpsMigration(
        db,
        {
          nodeId,
          gatewayOrigin: required("gateway"),
          sourceInventory: await privateJson(required("source-inventory")),
          targetInventory: await privateJson(required("target-inventory")),
          approvedAgentImage: required("approved-agent-image"),
        },
        () => inspect(nodeId),
      );
      await db.query("COMMIT");
      await privateWrite(required("output"), `${JSON.stringify(plan, null, 2)}\n`);
      console.log(
        JSON.stringify({
          planned: true,
          nodeId,
          quarantinedInteractiveRuns: plan.quarantinedInteractiveRunIds.length,
          productionMutated: false,
        }),
      );
    }
  } finally {
    db.release();
    await pool.end();
  }
}
void main().catch((error) => {
  const message = error instanceof Error ? error.message : "migration_failed";
  console.error(
    /^[a-z0-9_-]+$/.test(message) ? message : "migration_failed_private_details_suppressed",
  );
  process.exitCode = 1;
});
