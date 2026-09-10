import "server-only";

import { sql } from "drizzle-orm";
import { hasPermission } from "../authz";
import type { DatabaseTransaction } from "../db/client";
import { configuredFacebookKeyring } from "../social/facebook-vault-crypto";
import type { FleetState } from "./policy";
import { openBrowserSandboxKey } from "./sandbox-credentials";
import { matches } from "./security";

/** Internal dispatch check for manual browser demand. Re-run before provider
 * creation/resume and again before credential release. Never return this value
 * through an Action or serialize it into Workflow history.
 * Background publication/inbox demand requires its own current grant checks.
 */
export async function authorizeManualSandboxStart(
  tx: DatabaseTransaction,
  nodeId: string,
  operationId: string,
  now = Date.now(),
) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return null;
  const node = await tx.execute(sql`SELECT owner_id, status, document, key_hash
    FROM browser_fleet_node WHERE id = ${nodeId} FOR UPDATE`);
  const row = node.rows[0] as
    | {
        owner_id: string;
        status: string;
        document: FleetState;
        key_hash: string;
      }
    | undefined;
  if (row?.status !== "active" || row.document.version !== 1) return null;
  const metadata = await tx.execute(sql`SELECT sandbox_name, operation_id, operation_kind,
    phase, access_key_ciphertext FROM browser_sandbox WHERE node_id = ${nodeId} FOR UPDATE`);
  const managed = metadata.rows[0] as
    | {
        sandbox_name: string;
        operation_id: string;
        operation_kind: string;
        phase: string;
        access_key_ciphertext: string | null;
      }
    | undefined;
  if (
    !managed ||
    managed.operation_id !== operationId ||
    managed.operation_kind !== "start" ||
    !["starting", "unknown"].includes(managed.phase) ||
    !managed.access_key_ciphertext
  )
    return null;
  const owners = await tx.execute(sql`SELECT role, banned FROM "user" WHERE id = ${row.owner_id}`);
  const owner = owners.rows[0] as { role: string; banned: boolean | null } | undefined;
  if (!owner || owner.banned || !hasPermission(owner.role, "settings:manage")) return null;
  const sessions = await tx.execute(sql`SELECT id FROM "session" WHERE user_id = ${row.owner_id}
    AND expires_at > ${new Date(now)}`);
  const validSessions = new Set(sessions.rows.map((item) => item.id));
  const demand = row.document.runs.some((run) => {
    const account = row.document.accounts.find((item) => item.id === run.accountId);
    return (
      run.kind === "interactive" &&
      run.status === "queued" &&
      !run.stopRequested &&
      run.requestedBy === row.owner_id &&
      run.authSessionId &&
      validSessions.has(run.authSessionId) &&
      run.createdAt <= now &&
      now - run.createdAt < 900000 &&
      account?.enabled &&
      account.credentialVersion === run.credentialVersion &&
      account.proxyCiphertext &&
      account.expectedEgressIp
    );
  });
  if (!demand) return null;
  const accessKey = openBrowserSandboxKey(
    nodeId,
    managed.access_key_ciphertext,
    configuredFacebookKeyring(),
  );
  if (!matches(accessKey, row.key_hash)) throw new Error("sandbox_key_version_mismatch");
  return { sandboxName: managed.sandbox_name, accessKey };
}
