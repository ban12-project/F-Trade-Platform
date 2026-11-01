import { sql } from "drizzle-orm";
import type { FleetState } from "@/lib/browser-fleet/policy";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import {
  PublishingAccountUnavailableError,
  publishingAccountReadiness,
  publishingBlockers,
} from "./publishing-account-policy";

type Db = Pick<Database | DatabaseTransaction, "execute">;
/** Read-only projection; never wakes a node, changes grants, or returns credentials. */
export async function listPublishingAccounts(database: Db = getDatabase(), ownerId?: string) {
  const result = await database.execute(sql`SELECT b.id, b.node_id, b.channel_ref, b.account_ref,
    n.status, n.document, c.enabled, c.circuit_status, c.pause_reason, p.id AS recovery_id, p.project_id AS recovery_project_id
    FROM browser_fleet_binding b JOIN browser_fleet_node n ON n.id = b.node_id
    LEFT JOIN social_channel_control c ON c.channel_ref = b.channel_ref AND c.account_ref = b.account_ref
    LEFT JOIN LATERAL (SELECT p.id, p.project_id FROM social_publication p
      WHERE p.channel_ref=b.channel_ref AND p.account_ref=b.account_ref AND p.status IN ('unknown','failed','paused')
      AND EXISTS (SELECT 1 FROM workspace_project_member m WHERE m.project_id=p.project_id AND m.user_id=n.owner_id)
      ORDER BY (p.status='unknown') DESC, p.created_at DESC LIMIT 1) p ON true
    WHERE ${ownerId ? sql`n.owner_id = ${ownerId}` : sql`true`}
    ORDER BY n.created_at, b.id`);
  const accounts = result.rows.map((row) => {
    const state = row.document as FleetState;
    const account = (Array.isArray(state.accounts) ? state.accounts : []).find(
      (a) =>
        a.id === row.id && a.channelRef === row.channel_ref && a.accountRef === row.account_ref,
    );
    const summary = publishingAccountReadiness({
      id: String(row.id),
      nodeId: String(row.node_id),
      channelRef: String(row.channel_ref),
      accountRef: String(row.account_ref),
      state,
      account,
      nodeStatus: String(row.status),
      control:
        row.enabled === null
          ? undefined
          : {
              enabled: row.enabled === true,
              circuitStatus: String(row.circuit_status),
              pauseReason: row.pause_reason as string | null,
            },
    });
    if (ownerId && row.recovery_id && row.recovery_project_id)
      summary.recoveryHref = `/workspace/${encodeURIComponent(String(row.recovery_project_id))}/records/publication/${encodeURIComponent(String(row.recovery_id))}`;
    return summary;
  });
  if (!ownerId || ownerId === process.env.SOCIAL_FACEBOOK_OWNER_USER_ID) {
    const legacy =
      await database.execute(sql`SELECT c.id, c.channel_ref, c.account_ref, c.enabled, c.circuit_status, c.pause_reason
      FROM social_channel_control c WHERE NOT EXISTS (SELECT 1 FROM browser_fleet_binding b WHERE b.channel_ref=c.channel_ref AND b.account_ref=c.account_ref)`);
    for (const row of legacy.rows)
      accounts.push(
        publishingAccountReadiness({
          id: String(row.id),
          nodeId: null,
          channelRef: String(row.channel_ref),
          accountRef: String(row.account_ref),
          control: {
            enabled: row.enabled === true,
            circuitStatus: String(row.circuit_status),
            pauseReason: row.pause_reason as string | null,
          },
        }),
      );
  }
  return accounts;
}
export async function assertPublishingAccountReady(
  database: Db,
  scope: { channelRef: string; accountRef: string },
  ownerId?: string,
) {
  // Match executor lock order: node first, then project/control/job rows.
  await database.execute(sql`SELECT n.id FROM browser_fleet_node n
    JOIN browser_fleet_binding b ON b.node_id = n.id
    WHERE b.channel_ref = ${scope.channelRef} AND b.account_ref = ${scope.accountRef}
    FOR SHARE OF n`);
  const accounts = await listPublishingAccounts(database, ownerId);
  const account = accounts.find(
    (a) => a.channelRef === scope.channelRef && a.accountRef === scope.accountRef,
  );
  if (!account?.ready)
    throw new PublishingAccountUnavailableError(
      account ? publishingBlockers[account.blockers[0]] : publishingBlockers.binding,
    );
  return account;
}

/** New UI confirmations must not reach an older worker that still publishes to
 * its saved private audience during a rolling deployment. */
export async function assertPublicPublishingAccountReady(
  database: Db,
  scope: { channelRef: string; accountRef: string },
  ownerId?: string,
) {
  const account = await assertPublishingAccountReady(database, scope, ownerId);
  if (account.audience !== "Public")
    throw new PublishingAccountUnavailableError(
      "该账号的发布服务尚未确认公开范围支持。本批未提交，请待服务更新后重试；内容和账号选择已保留。",
    );
  return account;
}
