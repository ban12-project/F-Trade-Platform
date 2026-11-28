import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { socialBrowserJob } from "@/lib/db/schema";
import { enqueueRun, type FleetState, publicationScopeActive } from "./policy";

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
      !publicationScopeActive(state, account, now) ||
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
          sql`EXISTS (SELECT 1 FROM social_publication p JOIN workspace_project w ON w.id = p.project_id WHERE p.browser_job_id = ${socialBrowserJob.id} AND w.status = 'active')`,
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
      true, // The queued job had no reservation; only a proven pre-authorization failure may be bypassed.
    );
    await tx.execute(
      sql`INSERT INTO browser_fleet_publication (job_id, node_id, run_id) VALUES (${job.id}, ${nodeId}, ${run.id})`,
    );
  }
}
