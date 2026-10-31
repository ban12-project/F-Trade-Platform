import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { type FleetState, isLive } from "./policy";
import { createAccessKey, digest, secureOrigin } from "./security";
import { browserVpsInventorySchema, verifyBrowserVpsRestore } from "./vps-migration-contract";

export const providerMigrationObservation = z
  .object({
    name: z.string(),
    status: z.literal("stopped"),
    persistent: z.literal(true),
    nodeTag: z.uuid(),
    snapshotId: z.string().min(1),
    snapshotStatus: z.literal("created"),
    snapshotExpiresAt: z.iso.datetime(),
    lastSessionId: z.string().min(1),
  })
  .strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const browserVpsMigrationPlanSchema = z
  .object({
    version: z.literal(1),
    nodeId: z.uuid(),
    createdAt: z.iso.datetime(),
    gatewayOrigin: z.string().transform(secureOrigin),
    databaseHash: hash,
    provider: providerMigrationObservation,
    sourceInventory: browserVpsInventorySchema,
    targetInventory: browserVpsInventorySchema,
    approvedAgentImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    quarantinedInteractiveRunIds: z.array(z.uuid()),
  })
  .strict();
export type BrowserVpsMigrationPlan = z.infer<typeof browserVpsMigrationPlanSchema>;
type Query = Pick<PoolClient, "query">;
type NodeRow = {
  id: string;
  owner_id: string;
  status: string;
  gateway_origin: string | null;
  key_hash: string;
  document: FleetState;
};
type Snapshot = {
  node: NodeRow;
  lifecycle: Record<string, unknown>;
  outbox: Array<Record<string, unknown>>;
};

export function migrationHash(value: unknown): string {
  function stable(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, stable(x)]),
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(stable(value)) ?? "undefined")
    .digest("hex");
}
async function readSnapshot(db: Query, nodeId: string, lock: boolean): Promise<Snapshot> {
  // Same lock order as broker commands. JSON conversion normalizes timestamps
  // identically for node-postgres and avoids driver-specific Date hashes.
  const suffix = lock ? " FOR UPDATE" : "";
  const node = (
    await db.query(`SELECT to_jsonb(n) AS row FROM browser_fleet_node n WHERE id=$1${suffix}`, [
      nodeId,
    ])
  ).rows[0]?.row;
  const lifecycle = (
    await db.query(`SELECT to_jsonb(s) AS row FROM browser_sandbox s WHERE node_id=$1${suffix}`, [
      nodeId,
    ])
  ).rows[0]?.row;
  const outbox = (
    await db.query(
      `SELECT to_jsonb(o) AS row FROM browser_sandbox_outbox o WHERE node_id=$1 ORDER BY operation_id${suffix}`,
      [nodeId],
    )
  ).rows.map((r) => r.row);
  if (!node || !lifecycle) throw new Error("migration_managed_node_missing");
  return { node, lifecycle, outbox };
}
function validateDatabase(snapshot: Snapshot) {
  const { node, lifecycle, outbox } = snapshot;
  if (node.status !== "active" || node.document.version !== 1 || !Array.isArray(node.document.runs))
    throw new Error("migration_node_unavailable");
  if (
    lifecycle.phase !== "stopped" ||
    lifecycle.session_id !== null ||
    lifecycle.operation_id !== null ||
    lifecycle.operation_kind !== null
  )
    throw new Error("migration_provider_operation_pending");
  // dispatch_operation_id deliberately survives a confirmed stop as history;
  // phase/session/operation and outbox delivery determine whether work is pending.
  if (
    outbox.some(
      (row) => row.workflow_run_id === null || row.claim_id !== null || row.claim_until !== null,
    )
  )
    throw new Error("migration_outbox_pending");
  const quarantine: string[] = [];
  for (const run of node.document.runs) {
    if (
      run.status === "quarantined" &&
      run.kind === "interactive" &&
      run.leaseUntil <= Date.now() &&
      run.deadline <= Date.now()
    )
      quarantine.push(run.id);
    else if (run.status === "queued" || isLive(run))
      throw new Error("migration_new_or_live_demand");
  }
  return quarantine.sort();
}
function validateProvider(raw: unknown, nodeId: string) {
  const value = providerMigrationObservation.parse(raw);
  if (
    value.name !== `ftrade-browser-${nodeId}` ||
    value.nodeTag !== nodeId ||
    Date.parse(value.snapshotExpiresAt) < Date.now() + 3600000
  )
    throw new Error("migration_source_not_retained");
  return value;
}
export async function planBrowserVpsMigration(
  db: Query,
  input: {
    nodeId: string;
    gatewayOrigin: string;
    sourceInventory: unknown;
    targetInventory: unknown;
    approvedAgentImage: string;
  },
  inspect: () => Promise<unknown>,
) {
  const nodeId = z.uuid().parse(input.nodeId);
  const snapshot = await readSnapshot(db, nodeId, false);
  const quarantinedInteractiveRunIds = validateDatabase(snapshot);
  verifyBrowserVpsRestore(
    input.sourceInventory,
    input.targetInventory,
    snapshot.node.document,
    input.approvedAgentImage,
  );
  const source = browserVpsInventorySchema.parse(input.sourceInventory);
  if (source.nodeId !== nodeId) throw new Error("migration_inventory_node_mismatch");
  return browserVpsMigrationPlanSchema.parse({
    version: 1,
    nodeId,
    createdAt: new Date().toISOString(),
    gatewayOrigin: input.gatewayOrigin,
    databaseHash: migrationHash(snapshot),
    provider: validateProvider(await inspect(), nodeId),
    sourceInventory: source,
    targetInventory: input.targetInventory,
    approvedAgentImage: input.approvedAgentImage,
    quarantinedInteractiveRunIds,
  });
}

/** Caller owns BEGIN/COMMIT/ROLLBACK. No provider mutation, no lease changes.
 * Private archive/key must be fsynced BEFORE commit; an ambiguous commit is
 * inspected, never retried with a fresh key. */
export async function applyBrowserVpsMigration(
  db: Query,
  rawPlan: unknown,
  dependencies: {
    inspect: () => Promise<unknown>;
    persistPrivateArtifacts: (archive: unknown, key: string) => Promise<void>;
    allowInteractiveQuarantineRecovery: boolean;
  },
) {
  const plan = browserVpsMigrationPlanSchema.parse(rawPlan);
  await db.query("SET LOCAL lock_timeout='5s'");
  await db.query("SET LOCAL statement_timeout='15s'");
  await db.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
  const snapshot = await readSnapshot(db, plan.nodeId, true);
  if (migrationHash(snapshot) !== plan.databaseHash)
    throw new Error("migration_state_changed_replan");
  const quarantine = validateDatabase(snapshot);
  if (quarantine.length && !dependencies.allowInteractiveQuarantineRecovery)
    throw new Error("migration_quarantine_recovery_not_acknowledged");
  if (migrationHash(quarantine) !== migrationHash(plan.quarantinedInteractiveRunIds))
    throw new Error("migration_quarantine_changed");
  verifyBrowserVpsRestore(
    plan.sourceInventory,
    plan.targetInventory,
    snapshot.node.document,
    plan.approvedAgentImage,
  );
  const observed = validateProvider(await dependencies.inspect(), plan.nodeId);
  if (migrationHash(observed) !== migrationHash(plan.provider))
    throw new Error("migration_provider_changed_replan");
  const key = createAccessKey(plan.nodeId);
  const migrationId = randomUUID();
  await dependencies.persistPrivateArtifacts(
    {
      version: 1,
      migrationId,
      createdAt: new Date().toISOString(),
      plan,
      previous: snapshot,
      newKeyHash: digest(key),
    },
    key,
  );
  await db.query("DELETE FROM browser_sandbox_outbox WHERE node_id=$1", [plan.nodeId]);
  await db.query("DELETE FROM browser_sandbox WHERE node_id=$1", [plan.nodeId]);
  // Never overwrite the fleet document: all historical unknown and quarantined
  // records remain for the existing Agent recover protocol.
  await db.query("UPDATE browser_fleet_node SET gateway_origin=$2,key_hash=$3 WHERE id=$1", [
    plan.nodeId,
    plan.gatewayOrigin,
    digest(key),
  ]);
  await db.query(
    `INSERT INTO audit_event(id,action,actor_type,actor_id,subject_type,subject_id,metadata,occurred_at)
    VALUES($1,'browser_node.vps_migrated','system',$2,'browser_node',$3,$4::jsonb,now())`,
    [
      migrationId,
      "vps-migration-cli",
      plan.nodeId,
      JSON.stringify({
        migration_id: migrationId,
        provider: "vps",
        preserved_account_volumes: plan.sourceInventory.accountVolumes.length,
        interactive_recovery_required: quarantine.length,
      }),
    ],
  );
  return { migrationId, nodeId: plan.nodeId, recoveryRequired: quarantine.length };
}
