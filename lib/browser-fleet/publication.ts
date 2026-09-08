import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { socialBrowserJob, socialChannelControl, socialPublication } from "@/lib/db/schema";
import { buildFacebookPublicationPayload } from "@/lib/social/facebook-media-store";
import { digestSocialWorkerPayload } from "@/lib/social/worker-protocol";
import { type Account, enqueueRun, type FleetState, type Run } from "./policy";

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
