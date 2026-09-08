import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { socialChannelControl } from "@/lib/db/schema";
import { ingestFacebookInboundBatch } from "@/lib/social/facebook-inbound-store";
import { digestSocialWorkerPayload } from "@/lib/social/worker-protocol";
import { verifyInboxPacket } from "./inbox-protocol";
import { type Account, type FleetState, inboxScopeActive, type Run } from "./policy";

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
    !inboxScopeActive(state, account, now) ||
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
  if (run.inboxCompletion) throw new Error("inbox_scan_already_complete");
  if (receipts.length >= (packet.completion ? 101 : 100)) throw new Error("inbox_batch_limit");
  let result: { accepted: number; duplicates: number };
  if (packet.completion) {
    const started = Date.parse(packet.completion.scanStartedAt);
    if (
      started < run.createdAt ||
      started > observed ||
      observed < run.createdAt ||
      packet.completion.messageCount !==
        receipts.reduce((sum, item) => sum + item.accepted + item.duplicates, 0)
    )
      throw new Error("inbox_completion_invalid");
    const [control] = await tx
      .select()
      .from(socialChannelControl)
      .where(
        and(
          eq(socialChannelControl.channelRef, account.channelRef),
          eq(socialChannelControl.accountRef, account.accountRef),
        ),
      )
      .for("update");
    if (!control?.enabled || control.circuitStatus !== "active")
      throw new Error("inbound_channel_inactive");
    run.inboxCompletion = {
      observedAt: observed,
      reviewRef: packet.completion.reviewRef,
      coverage: packet.completion.coverage,
      conversationCount: packet.completion.conversationCount,
      messageCount: packet.completion.messageCount,
    };
    result = { accepted: 0, duplicates: 0 };
  } else {
    result = await ingestFacebookInboundBatch(
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
  }
  receipts.push({ requestId: packet.requestId, digest, ...result });
  return { ...result, replayed: false };
}
