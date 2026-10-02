import "server-only";

import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../db/client";
import { type FleetState, inboxScopeActive } from "./policy";

/** A stopped Sandbox may poll only currently enabled, explicitly reviewed
 * accounts. A queued lease alone is not a grant to start compute. */
export async function authorizedInboxAccounts(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  now: number,
) {
  const allowed = new Set<string>();
  if (!state.capabilities.includes("inbox") || !state.inboxScopes?.length) return allowed;
  for (const account of state.accounts) {
    if (
      !account.enabled ||
      account.authState !== "ready" ||
      account.pollSeconds < 300 ||
      !account.proxyCiphertext ||
      !account.expectedEgressIp ||
      !inboxScopeActive(state, account, now)
    )
      continue;
    const rows = await tx.execute(sql`SELECT 1 FROM browser_fleet_binding b
      JOIN social_channel_control c ON c.channel_ref = b.channel_ref
        AND c.account_ref = b.account_ref
      WHERE b.node_id = ${nodeId} AND b.channel_ref = ${account.channelRef}
        AND b.account_ref = ${account.accountRef}
        AND c.enabled = true AND c.circuit_status = 'active' LIMIT 1`);
    if (rows.rows.length) allowed.add(account.id);
  }
  return allowed;
}

export async function hasAuthorizedInboxDemand(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  now: number,
) {
  const allowed = await authorizedInboxAccounts(tx, nodeId, state, now);
  return state.runs.some(
    (run) =>
      run.kind === "inbox" &&
      run.status === "queued" &&
      !run.stopRequested &&
      run.requestedBy === "scheduler" &&
      allowed.has(run.accountId) &&
      state.accounts.find((account) => account.id === run.accountId)?.credentialVersion ===
        run.credentialVersion,
  );
}
