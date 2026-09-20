import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { hasPermission } from "../authz";
import type { DatabaseTransaction } from "../db/client";
import { socialBrowserJob, socialPublication } from "../db/schema";
import { buildFacebookPublicationPayload } from "../social/facebook-media-store";
import { assertWorkspaceProjectAccess } from "../workspace/access";
import { type FleetState, publicationScopeActive } from "./policy";

/** Publication demand is independent of an owner's interactive login session.
 * The original confirmer must still be an authorized project editor. Unknown
 * effects, stale confirmations and unreviewed scopes never authorize compute.
 * Called with the node lock held, before provisioning and credential release.
 */
export async function hasAuthorizedPublicationDemand(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  now: number,
) {
  if (!state.capabilities.includes("publish") || !state.publicationScopes) return false;
  for (const run of state.runs) {
    const account = state.accounts.find((item) => item.id === run.accountId);
    if (
      run.kind !== "publish" ||
      run.status !== "queued" ||
      run.stopRequested ||
      !run.jobRef ||
      !account?.enabled ||
      account.authState !== "ready" ||
      account.credentialVersion !== run.credentialVersion ||
      !account.proxyCiphertext ||
      !account.expectedEgressIp ||
      !publicationScopeActive(state, account, now)
    )
      continue;
    const binding = await tx.execute(sql`SELECT id FROM browser_fleet_binding
      WHERE node_id = ${nodeId} AND channel_ref = ${account.channelRef}
      AND account_ref = ${account.accountRef}`);
    if (!binding.rows.length) continue;
    const [record] = await tx
      .select({ publication: socialPublication })
      .from(socialBrowserJob)
      .innerJoin(
        socialPublication,
        and(
          eq(socialPublication.id, socialBrowserJob.payloadRef),
          eq(socialPublication.browserJobId, socialBrowserJob.id),
        ),
      )
      .where(
        and(
          eq(socialBrowserJob.id, run.jobRef),
          eq(socialBrowserJob.kind, "publish"),
          eq(socialBrowserJob.status, "queued"),
          eq(socialPublication.status, "submitted"),
          eq(socialBrowserJob.channelRef, account.channelRef),
          eq(socialBrowserJob.accountRef, account.accountRef),
          eq(socialPublication.channelRef, account.channelRef),
          eq(socialPublication.accountRef, account.accountRef),
          sql`EXISTS (SELECT 1 FROM workspace_project w WHERE w.id = ${socialPublication.projectId} AND w.status = 'active')`,
          sql`EXISTS (SELECT 1 FROM browser_fleet_publication p WHERE p.job_id = ${socialBrowserJob.id}
          AND p.node_id = ${nodeId} AND p.run_id = ${run.id} AND p.authorization_id IS NULL AND p.receipt IS NULL)`,
        ),
      );
    if (!record) continue;
    const confirmers = await tx.execute(sql`SELECT u.id, u.role, u.banned FROM audit_event e
      JOIN "user" u ON u.id = e.actor_id
      WHERE e.subject_id = ${record.publication.id} AND e.subject_type = 'social_publication'
      AND e.actor_type = 'human' AND e.action IN ('social_publication.submitted', 'facebook_media.confirmed')
      ORDER BY e.occurred_at ASC LIMIT 1`);
    const confirmer = confirmers.rows[0] as
      | { id: string; role: string; banned: boolean | null }
      | undefined;
    if (!confirmer || confirmer.banned || !hasPermission(confirmer.role, "content:write")) continue;
    try {
      await assertWorkspaceProjectAccess(record.publication.projectId, confirmer.id, "write", tx);
      await buildFacebookPublicationPayload(tx, record.publication, new Date(now));
      return true;
    } catch {
      // A rejected candidate does not authorize provisioning or release secrets.
    }
  }
  return false;
}
