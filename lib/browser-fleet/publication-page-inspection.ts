import "server-only";
import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { and, eq, sql } from "drizzle-orm";
import { hasPermission } from "../authz";
import { type Database, getDatabase } from "../db/client";
import { auditEvent, session, user } from "../db/schema";
import type { FleetState } from "./policy";
import {
  type PublicationPageInspection,
  publicationPageInspectionInputSchema,
  publicationPageInspectionSchema,
} from "./publication-page-inspection-contract";
import type { BrowserSandboxProvider } from "./sandbox-provider";
import { secureOrigin } from "./security";
import { ownerBrowserCommand } from "./store";

type Actor = { id: string; sessionId: string };
type Request = { nodeId: string; runId: string };
async function currentInspectionAccess(
  value: Request,
  actor: Actor,
  db: Database,
  final?: { origin: string; observation: PublicationPageInspection },
) {
  return db.transaction(async (tx) => {
    const [auth] = await tx
      .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
      .from(session)
      .innerJoin(user, eq(user.id, session.userId))
      .where(and(eq(session.id, actor.sessionId), eq(session.userId, actor.id)))
      .for("share");
    const rows = await tx.execute(
      sql`SELECT n.gateway_origin,n.document FROM browser_fleet_node n JOIN browser_sandbox s ON s.node_id=n.id WHERE n.id=${value.nodeId} AND n.owner_id=${actor.id} AND n.status='active' FOR SHARE OF n`,
    );
    const row = rows.rows[0],
      state = row?.document as FleetState | undefined;
    const run = state?.runs?.find((r) => r.id === value.runId),
      now = Date.now();
    if (
      !auth ||
      auth.banned ||
      !hasPermission(auth.role, "settings:manage") ||
      auth.expiresAt.getTime() <= now ||
      !row ||
      state?.version !== 1 ||
      !run ||
      run.kind !== "interactive" ||
      run.requestedBy !== actor.id ||
      run.authSessionId !== actor.sessionId ||
      run.status !== "running" ||
      run.stopRequested ||
      run.deadline <= now ||
      run.leaseUntil <= now + 1000
    )
      throw new Error("inspection_access_invalid");
    const access = {
      origin: secureOrigin(String(row.gateway_origin)),
      authExpiresAt: auth.expiresAt.getTime(),
      runDeadline: Math.min(run.deadline, run.leaseUntil),
    };
    if (final) {
      const alive = () => {
        const at = Date.now(),
          observed = Date.parse(final.observation.observedAt);
        if (
          access.origin !== final.origin ||
          access.authExpiresAt <= at ||
          access.runDeadline <= at ||
          at - observed > 15000 ||
          observed > at + 5000
        )
          throw new Error("inspection_observation_stale");
      };
      alive();
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "browser_publication_page.inspected",
        actorType: "human",
        actorId: actor.id,
        subjectType: "browser_node",
        subjectId: value.nodeId,
        metadata: {
          candidate_hash: final.observation.candidateHash,
          observed_at: final.observation.observedAt,
          candidate_expired: Date.parse(final.observation.candidateExpiresAt) <= Date.now(),
          identity_matches_candidate: final.observation.identityMatched,
          controls: final.observation.controls,
          composer_identity_matches_candidate: final.observation.composerIdentityMatched,
          composer_empty: final.observation.composerEmpty,
          audience_matches_candidate: final.observation.audienceMatchesCandidate,
          video_preview_count: final.observation.videoPreviewCount,
          video_receipt_visible: final.observation.videoReceiptVisible,
        },
        occurredAt: new Date(),
      });
      alive();
    }
    return access;
  });
}
const defaultDependencies = {
  provider: Sandbox as Pick<BrowserSandboxProvider, "get">,
  ticket: (input: Request, actor: Actor) =>
    ownerBrowserCommand({ operation: "ticket", ...input }, actor),
  request: fetch,
  appOrigin: () => secureOrigin(process.env.BROWSER_SANDBOX_PLATFORM_ORIGIN ?? ""),
};
export async function inspectOwnedPublicationPage(
  input: unknown,
  actor: Actor,
  database: Database = getDatabase(),
  dependencies = defaultDependencies,
) {
  const value = publicationPageInspectionInputSchema.parse(input);
  const before = await currentInspectionAccess(value, actor, database);
  const sandbox = await dependencies.provider.get({
    name: `ftrade-browser-${value.nodeId}`,
    resume: false,
  });
  if (
    sandbox.name !== `ftrade-browser-${value.nodeId}` ||
    sandbox.tags?.["ftrade-node"] !== value.nodeId ||
    !sandbox.persistent ||
    sandbox.status !== "running"
  )
    throw new Error("inspection_runtime_unavailable");
  const origin = secureOrigin(sandbox.domain(9400));
  if (origin !== before.origin || !new URL(origin).hostname.endsWith(".vercel.run"))
    throw new Error("inspection_origin_invalid");
  await currentInspectionAccess(value, actor, database);
  const ticket = await dependencies.ticket(value, actor);
  if (
    !ticket.connection ||
    ticket.connection.origin !== origin ||
    ticket.connection.expiresAt <= Date.now()
  )
    throw new Error("inspection_ticket_invalid");
  const response = await dependencies.request(`${origin}/publication-inspection`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", Origin: dependencies.appOrigin() },
    body: JSON.stringify({ ticket: ticket.connection.token }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("inspection_unavailable");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > 8192) throw new Error("inspection_response_invalid");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const observation = publicationPageInspectionSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  const after = await currentInspectionAccess(value, actor, database, { origin, observation }),
    now = Date.now();
  if (
    after.origin !== origin ||
    after.authExpiresAt <= now ||
    after.runDeadline <= now ||
    now - Date.parse(observation.observedAt) > 15000 ||
    Date.parse(observation.observedAt) > now + 5000
  )
    throw new Error("inspection_observation_stale");
  return { ...observation, candidateExpired: Date.parse(observation.candidateExpiresAt) <= now };
}
