import "server-only";

import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../db/client";
import { type FleetState, inboxScopeActive } from "./policy";

/** A stopped Sandbox may poll only a currently enabled, explicitly reviewed
 * account. The queued lease alone is not a grant to start compute. */
export async function hasAuthorizedInboxDemand(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  now: number,
) {
  if (!state.capabilities.includes("inbox") || !state.inboxScopes?.length) return false;
  for (const run of state.runs) {
    const account = state.accounts.find((item) => item.id === run.accountId);
    if (
      run.kind !== "inbox" ||
      run.status !== "queued" ||
      run.stopRequested ||
      run.requestedBy !== "scheduler" ||
      !account?.enabled ||
      account.authState !== "ready" ||
      account.pollSeconds < 300 ||
      account.credentialVersion !== run.credentialVersion ||
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
    if (rows.rows.length) return true;
  }
  return false;
}
