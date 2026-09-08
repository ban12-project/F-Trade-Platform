import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { publishContent } from "@/lib/content/gate";
import type { DatabaseTransaction } from "@/lib/db/client";
import {
  aggregateRecord,
  auditEvent,
  socialBrowserJob,
  socialChannelControl,
  socialPublication,
} from "@/lib/db/schema";
import {
  buildFacebookPublicationPayload,
  resolveFacebookMediaSource,
} from "@/lib/social/facebook-media-store";
import { digestSocialWorkerPayload } from "@/lib/social/worker-protocol";
import { type Account, enqueueRun, type FleetState, type Run, requestStop } from "./policy";

/** Called under the node row lock. The job lock and unique reservation exclude
 * legacy workers and duplicate polls, including after terminal run pruning. */
export async function schedulePublications(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  now: number,
) {
  if (!state.capabilities.includes("publish")) return;
  for (const account of state.accounts) {
    if (
      !account.enabled ||
      account.authState !== "ready" ||
      !account.expectedEgressIp ||
      state.runs.some(
        (run) =>
          run.accountId === account.id &&
          run.kind === "publish" &&
          ["queued", "starting", "running", "stopping", "quarantined"].includes(run.status),
      )
    )
      continue;
    if (state.runs.filter((run) => run.status === "queued").length >= 200) break;
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(
        and(
          eq(socialBrowserJob.kind, "publish"),
          eq(socialBrowserJob.status, "queued"),
          eq(socialBrowserJob.channelRef, account.channelRef),
          eq(socialBrowserJob.accountRef, account.accountRef),
          sql`EXISTS (SELECT 1 FROM browser_fleet_binding b WHERE b.node_id = ${nodeId} AND b.channel_ref = ${socialBrowserJob.channelRef} AND b.account_ref = ${socialBrowserJob.accountRef})`,
          sql`NOT EXISTS (SELECT 1 FROM browser_fleet_publication p WHERE p.job_id = ${socialBrowserJob.id})`,
        ),
      )
      .orderBy(socialBrowserJob.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) continue;
    const run = enqueueRun(
      state,
      {
        id: randomUUID(),
        accountId: account.id,
        kind: "publish",
        jobRef: job.id,
        requestedBy: nodeId,
        authSessionId: null,
      },
      now,
    );
    await tx.execute(
      sql`INSERT INTO browser_fleet_publication (job_id, node_id, run_id) VALUES (${job.id}, ${nodeId}, ${run.id})`,
    );
  }
}

export async function claimPublication(
  tx: DatabaseTransaction,
  nodeId: string,
  run: Run,
  account: Account,
  now: number,
): Promise<Record<string, unknown> | null> {
  if (!run.jobRef) throw new Error("publication_reservation_missing");
  const reservation = await tx.execute(
    sql`SELECT * FROM browser_fleet_publication WHERE node_id = ${nodeId} AND run_id = ${run.id} AND job_id = ${run.jobRef} FOR UPDATE`,
  );
  if (!reservation.rows[0]) throw new Error("publication_reservation_missing");
  const [job] = await tx
    .select()
    .from(socialBrowserJob)
    .where(eq(socialBrowserJob.id, run.jobRef))
    .for("update");
  if (!job || !["queued", "claimed"].includes(job.status)) return null;
  const [publication] = await tx
    .select()
    .from(socialPublication)
    .where(
      and(eq(socialPublication.id, job.payloadRef), eq(socialPublication.browserJobId, job.id)),
    )
    .for("update");
  try {
    if (
      !publication ||
      job.accountRef !== account.accountRef ||
      job.channelRef !== account.channelRef ||
      publication.status !== "submitted" ||
      publication.channelRef !== job.channelRef ||
      publication.accountRef !== job.accountRef
    )
      throw new Error("publication_scope_invalid");
    const payload = await buildFacebookPublicationPayload(tx, publication, new Date(now));
    const prior = reservation.rows[0].payload as Record<string, unknown> | null;
    if (
      job.status === "claimed" &&
      (!prior || digestSocialWorkerPayload(prior) !== digestSocialWorkerPayload(payload))
    )
      throw new Error("publication_changed");
    await tx
      .update(socialBrowserJob)
      .set({ status: "claimed", updatedAt: new Date(now) })
      .where(eq(socialBrowserJob.id, job.id));
    await tx.execute(
      sql`UPDATE browser_fleet_publication SET payload = ${JSON.stringify(payload)}::jsonb WHERE job_id = ${job.id}`,
    );
    return payload;
  } catch {
    // Once a payload has been disclosed, a later rejection cannot prove that no
    // external effect occurred. Reconciliation must conservatively mark unknown.
    if (job.status === "claimed") return null;
    run.status = "failed";
    run.failure = "publication_preflight_rejected";
    await tx
      .update(socialBrowserJob)
      .set({
        status: "paused",
        failureCode: "fleet_publication_preflight_rejected",
        updatedAt: new Date(now),
      })
      .where(eq(socialBrowserJob.id, job.id));
    if (publication)
      await tx
        .update(socialPublication)
        .set({ status: "paused", updatedAt: new Date(now) })
        .where(eq(socialPublication.id, publication.id));
    return null;
  }
}

/** Browser shutdown is never a publication receipt. Keep claimed effects unknown
 * even if an adapter reports completed, and never automatically requeue them. */
export async function reconcilePublications(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  now: number,
) {
  for (const run of state.runs) {
    if (
      run.kind !== "publish" ||
      !run.jobRef ||
      !["failed", "unknown", "quarantined", "completed"].includes(run.status)
    )
      continue;
    const reservation = await tx.execute(
      sql`SELECT job_id FROM browser_fleet_publication WHERE node_id = ${nodeId} AND run_id = ${run.id} AND job_id = ${run.jobRef}`,
    );
    if (!reservation.rows.length) continue;
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(eq(socialBrowserJob.id, run.jobRef))
      .for("update");
    if (!job || !["queued", "claimed"].includes(job.status)) continue;
    const unknown = job.status === "claimed";
    await tx
      .update(socialBrowserJob)
      .set({
        status: "paused",
        failureCode: unknown ? "fleet_publication_result_unknown" : "fleet_publication_cancelled",
        updatedAt: new Date(now),
      })
      .where(eq(socialBrowserJob.id, job.id));
    await tx
      .update(socialPublication)
      .set({ status: unknown ? "unknown" : "paused", updatedAt: new Date(now) })
      .where(
        and(eq(socialPublication.id, job.payloadRef), eq(socialPublication.browserJobId, job.id)),
      );
    if (unknown)
      await tx
        .update(socialChannelControl)
        .set({
          circuitStatus: "paused",
          pauseReason: "external_result_unknown",
          pauseEvidenceRef: job.id,
          changedAt: new Date(now),
          updatedAt: new Date(now),
        })
        .where(
          and(
            eq(socialChannelControl.channelRef, job.channelRef),
            eq(socialChannelControl.accountRef, job.accountRef),
          ),
        );
  }
}

/** Authorize one external attempt, never minting a second attempt for the same
 * reserved job. Replays recover the original authorization only while valid. */
export async function authorizePublication(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  run: Run,
  payloadDigest: string,
  now: number,
) {
  const account = state.accounts.find((item) => item.id === run.accountId);
  if (
    run.kind !== "publish" ||
    !run.jobRef ||
    run.status !== "running" ||
    run.stopRequested ||
    run.leaseUntil <= now ||
    run.deadline <= now ||
    !account?.enabled ||
    account.authState !== "ready" ||
    account.credentialVersion !== run.credentialVersion ||
    !account.expectedEgressIp
  )
    throw new Error("publication_lease_inactive");
  const result = await tx.execute(sql`SELECT * FROM browser_fleet_publication
    WHERE node_id = ${nodeId} AND run_id = ${run.id} AND job_id = ${run.jobRef} FOR UPDATE`);
  const reservation = result.rows[0];
  if (
    !reservation?.payload ||
    digestSocialWorkerPayload(reservation.payload as Record<string, unknown>) !== payloadDigest
  )
    throw new Error("publication_payload_invalid");
  const binding = await tx.execute(
    sql`SELECT id FROM browser_fleet_binding WHERE node_id = ${nodeId} AND channel_ref = ${account.channelRef} AND account_ref = ${account.accountRef}`,
  );
  if (!binding.rows.length) throw new Error("publication_account_unbound");
  const [job] = await tx
    .select()
    .from(socialBrowserJob)
    .where(eq(socialBrowserJob.id, run.jobRef))
    .for("update");
  if (
    job?.status !== "claimed" ||
    job.kind !== "publish" ||
    job.channelRef !== account.channelRef ||
    job.accountRef !== account.accountRef
  )
    throw new Error("publication_not_claimed");
  const [publication] = await tx
    .select()
    .from(socialPublication)
    .where(
      and(eq(socialPublication.id, job.payloadRef), eq(socialPublication.browserJobId, job.id)),
    )
    .for("update");
  if (
    publication?.status !== "submitted" ||
    publication.channelRef !== account.channelRef ||
    publication.accountRef !== account.accountRef
  )
    throw new Error("publication_scope_invalid");
  const payload = await buildFacebookPublicationPayload(tx, publication, new Date(now));
  if (digestSocialWorkerPayload(payload) !== payloadDigest) throw new Error("publication_changed");
  if (reservation.authorization_id) {
    if (
      reservation.authorized_lease_id !== run.leaseId ||
      Number(reservation.authorized_until) <= now
    )
      throw new Error("publication_authorization_expired");
    return {
      authorizationId: String(reservation.authorization_id),
      expiresAt: Number(reservation.authorized_until),
      payloadDigest,
    };
  }
  const authorizationId = randomUUID();
  const expiresAt = Math.min(now + 30_000, run.leaseUntil, run.deadline);
  await tx.execute(
    sql`UPDATE browser_fleet_publication SET authorization_id = ${authorizationId}, authorized_lease_id = ${run.leaseId}, authorized_until = ${expiresAt} WHERE job_id = ${job.id}`,
  );
  return { authorizationId, expiresAt, payloadDigest };
}

export async function recordPublicationReceipt(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  run: Run,
  receipt: {
    authorizationId: string;
    payloadDigest: string;
    outcome: "published" | "unknown";
    externalPublicationRef?: string;
    failureCode?: string;
  },
  now: number,
) {
  if (run.kind !== "publish" || !run.jobRef) throw new Error("publication_run_invalid");
  const result = await tx.execute(
    sql`SELECT * FROM browser_fleet_publication WHERE node_id = ${nodeId} AND run_id = ${run.id} AND job_id = ${run.jobRef} FOR UPDATE`,
  );
  const reservation = result.rows[0];
  if (
    !reservation ||
    reservation.authorization_id !== receipt.authorizationId ||
    reservation.authorized_lease_id !== run.leaseId ||
    !reservation.payload ||
    digestSocialWorkerPayload(reservation.payload as Record<string, unknown>) !==
      receipt.payloadDigest
  )
    throw new Error("publication_receipt_scope_invalid");
  if (reservation.receipt) {
    if (
      digestSocialWorkerPayload(reservation.receipt as Record<string, unknown>) !==
      digestSocialWorkerPayload(receipt)
    )
      throw new Error("publication_receipt_conflict");
    return { outcome: receipt.outcome, replayed: true };
  }
  const account = state.accounts.find((item) => item.id === run.accountId);
  // Authorization bounds the start of the effect. Its receipt may arrive after
  // that short window, but a first receipt still requires the original live lease.
  if (
    run.status !== "running" ||
    run.stopRequested ||
    run.leaseUntil <= now ||
    run.deadline <= now ||
    !account?.enabled ||
    account.authState !== "ready" ||
    account.credentialVersion !== run.credentialVersion
  )
    throw new Error("publication_lease_inactive");
  const binding = await tx.execute(
    sql`SELECT id FROM browser_fleet_binding WHERE node_id = ${nodeId} AND channel_ref = ${account.channelRef} AND account_ref = ${account.accountRef}`,
  );
  if (!binding.rows.length) throw new Error("publication_account_unbound");
  const [job] = await tx
    .select()
    .from(socialBrowserJob)
    .where(eq(socialBrowserJob.id, run.jobRef))
    .for("update");
  if (
    job?.status !== "claimed" ||
    job.kind !== "publish" ||
    job.accountRef !== account.accountRef ||
    job.channelRef !== account.channelRef
  )
    throw new Error("publication_not_claimed");
  const [publication] = await tx
    .select()
    .from(socialPublication)
    .where(
      and(eq(socialPublication.id, job.payloadRef), eq(socialPublication.browserJobId, job.id)),
    )
    .for("update");
  if (
    publication?.status !== "submitted" ||
    publication.accountRef !== account.accountRef ||
    publication.channelRef !== account.channelRef
  )
    throw new Error("publication_scope_invalid");
  if (receipt.outcome === "published") {
    const payload = await buildFacebookPublicationPayload(tx, publication, new Date(now));
    if (
      digestSocialWorkerPayload(payload) !== receipt.payloadDigest ||
      !receipt.externalPublicationRef
    )
      throw new Error("publication_changed");
    // The database unique index also arbitrates concurrent duplicate external IDs.
    const [duplicate] = await tx
      .select({ id: socialPublication.id })
      .from(socialPublication)
      .where(
        and(
          eq(socialPublication.channelRef, account.channelRef),
          eq(socialPublication.accountRef, account.accountRef),
          eq(socialPublication.externalPublicationRef, receipt.externalPublicationRef),
        ),
      )
      .limit(1);
    if (duplicate) throw new Error("publication_external_ref_duplicate");
    await tx
      .update(socialBrowserJob)
      .set({
        status: "succeeded",
        resultRef: receipt.externalPublicationRef,
        failureCode: null,
        updatedAt: new Date(now),
      })
      .where(eq(socialBrowserJob.id, job.id));
    await tx
      .update(socialPublication)
      .set({
        status: "published",
        externalPublicationRef: receipt.externalPublicationRef,
        publishedAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(eq(socialPublication.id, publication.id));
    const [content] = await tx
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, publication.contentRef))
      .for("update");
    if (content.type === "content")
      await tx
        .update(aggregateRecord)
        .set({
          state: "CONTENT_PUBLISHED",
          payload: publishContent(content.payload, "system", receipt.externalPublicationRef),
          version: content.version + 1,
        })
        .where(eq(aggregateRecord.id, content.id));
  } else {
    await tx
      .update(socialBrowserJob)
      .set({
        status: "paused",
        failureCode: receipt.failureCode ?? "external_result_unknown",
        updatedAt: new Date(now),
      })
      .where(eq(socialBrowserJob.id, job.id));
    await tx
      .update(socialPublication)
      .set({ status: "unknown", updatedAt: new Date(now) })
      .where(eq(socialPublication.id, publication.id));
    await tx
      .update(socialChannelControl)
      .set({
        circuitStatus: "paused",
        pauseReason: "external_result_unknown",
        pauseEvidenceRef: job.id,
        changedAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(
        and(
          eq(socialChannelControl.channelRef, account.channelRef),
          eq(socialChannelControl.accountRef, account.accountRef),
        ),
      );
    account.authState = "result_unknown";
  }
  await tx.execute(
    sql`UPDATE browser_fleet_publication SET receipt = ${JSON.stringify(receipt)}::jsonb, received_at = ${new Date(now)} WHERE job_id = ${job.id}`,
  );
  await tx.insert(auditEvent).values({
    id: randomUUID(),
    actorType: "system",
    actorId: nodeId,
    action: `social_publication.${receipt.outcome}`,
    subjectType: "social_publication",
    subjectId: publication.id,
    aggregateId: publication.contentRef,
    metadata: {
      job_id: job.id,
      run_id: run.id,
      authorization_id: receipt.authorizationId,
      retry_allowed: false,
    },
    occurredAt: new Date(now),
  });
  run.publicationOutcome = receipt.outcome;
  requestStop(state, run);
  return { outcome: receipt.outcome, replayed: false };
}

export async function resolvePublicationMedia(
  tx: DatabaseTransaction,
  nodeId: string,
  state: FleetState,
  run: Run,
  payloadDigest: string,
  now: number,
) {
  const account = state.accounts.find((a) => a.id === run.accountId);
  if (
    run.kind !== "publish" ||
    !run.jobRef ||
    run.status !== "running" ||
    run.stopRequested ||
    run.leaseUntil <= now ||
    run.deadline <= now ||
    !account?.enabled ||
    account.authState !== "ready" ||
    account.credentialVersion !== run.credentialVersion
  )
    throw new Error("publication_lease_inactive");
  const reserved = await tx.execute(
    sql`SELECT payload FROM browser_fleet_publication WHERE node_id = ${nodeId} AND run_id = ${run.id} AND job_id = ${run.jobRef} FOR UPDATE`,
  );
  if (
    !reserved.rows[0]?.payload ||
    digestSocialWorkerPayload(reserved.rows[0].payload as Record<string, unknown>) !== payloadDigest
  )
    throw new Error("publication_payload_invalid");
  const binding = await tx.execute(
    sql`SELECT id FROM browser_fleet_binding WHERE node_id = ${nodeId} AND channel_ref = ${account.channelRef} AND account_ref = ${account.accountRef}`,
  );
  if (!binding.rows.length) throw new Error("publication_account_unbound");
  const [job] = await tx
    .select()
    .from(socialBrowserJob)
    .where(eq(socialBrowserJob.id, run.jobRef))
    .for("update");
  if (
    job?.status !== "claimed" ||
    job.kind !== "publish" ||
    job.accountRef !== account.accountRef ||
    job.channelRef !== account.channelRef
  )
    throw new Error("publication_not_claimed");
  const [publication] = await tx
    .select()
    .from(socialPublication)
    .where(
      and(eq(socialPublication.id, job.payloadRef), eq(socialPublication.browserJobId, job.id)),
    )
    .for("update");
  if (
    publication?.status !== "submitted" ||
    publication.accountRef !== account.accountRef ||
    publication.channelRef !== account.channelRef
  )
    throw new Error("publication_scope_invalid");
  const payload = await buildFacebookPublicationPayload(tx, publication, new Date(now));
  if (digestSocialWorkerPayload(payload) !== payloadDigest) throw new Error("publication_changed");
  return resolveFacebookMediaSource(tx, publication, new Date(now));
}
