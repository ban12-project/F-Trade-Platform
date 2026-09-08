import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { ingestFacebookInboundBatch } from "@/lib/social/facebook-inbound-store";
import { digestSocialWorkerPayload } from "@/lib/social/worker-protocol";
import { verifyInboxPacket } from "./inbox-protocol";
import type { Account, FleetState, Run } from "./policy";

/** Only the derived key is disclosed to this lease; the master key stays on the server. */
export function inboxSigningKey(nodeId: string, run: Run, account: Account) {
  const master = Buffer.from(process.env.SOCIAL_WORKER_SIGNING_KEY ?? "", "base64");
  if (master.length < 32) throw new Error("inbox_signing_key_missing");
  return createHmac("sha256", master)
    .update(
      JSON.stringify([
        "f-trade-inbox-lease-v1",
        nodeId,
        run.id,
        run.leaseId,
        account.channelRef,
        account.accountRef,
        run.credentialVersion,
      ]),
    )
    .digest("base64url");
}
export async function acceptInboxPacket(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  run: Run,
  envelope: unknown,
  now: number,
) {
  const account = state.accounts.find((item) => item.id === run.accountId);
  if (
    run.kind !== "inbox" ||
    run.status !== "running" ||
    run.stopRequested ||
    run.leaseUntil <= now ||
    run.deadline <= now ||
    !account?.enabled ||
    account.authState !== "ready" ||
    account.credentialVersion !== run.credentialVersion ||
    !account.expectedEgressIp ||
    !state.capabilities.includes("inbox")
  )
    throw new Error("inbox_lease_inactive");
  const binding = await tx.execute(
    sql`SELECT id FROM browser_fleet_binding WHERE node_id = ${nodeId} AND channel_ref = ${account.channelRef} AND account_ref = ${account.accountRef}`,
  );
  if (!binding.rows.length) throw new Error("inbox_account_unbound");
  const packet = verifyInboxPacket(inboxSigningKey(nodeId, run, account), envelope);
  if (packet.runId !== run.id || packet.leaseId !== run.leaseId)
    throw new Error("inbox_scope_invalid");
  const observed = Date.parse(packet.observedAt);
  if (observed > now || now - observed > 300000) throw new Error("inbox_packet_expired");
  const digest = digestSocialWorkerPayload(packet);
  run.inboxReceipts ??= [];
  const receipts = run.inboxReceipts;
  const existing = receipts.find((item) => item.requestId === packet.requestId);
  if (existing) {
    if (existing.digest !== digest) throw new Error("inbox_request_conflict");
    return { accepted: existing.accepted, duplicates: existing.duplicates, replayed: true };
  }
  if (receipts.length >= 100) throw new Error("inbox_batch_limit");
  const result = await ingestFacebookInboundBatch(
    tx,
    {
      channelRef: account.channelRef,
      accountRef: account.accountRef,
      observedAt: packet.observedAt,
      messages: packet.messages,
    },
    nodeId,
    new Date(now),
  );
  receipts.push({ requestId: packet.requestId, digest, ...result });
  return { ...result, replayed: false };
}
