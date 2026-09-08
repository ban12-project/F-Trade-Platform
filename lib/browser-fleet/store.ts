import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { hasPermission } from "@/lib/authz";
import { type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { auditEvent, session, user } from "@/lib/db/schema";
import {
  facebookLoginSecretSchema,
  facebookProxySecretSchema,
} from "@/lib/social/facebook-account-forms";
import {
  configuredFacebookKeyring,
  decryptFacebookCredential,
  encryptFacebookCredential,
} from "@/lib/social/facebook-vault-crypto";
import { digestSocialWorkerPayload } from "@/lib/social/worker-protocol";
import {
  type NodeRequest,
  nodeRequestSchema,
  type OwnerCommand,
  ownerCommandSchema,
} from "./contracts";
import {
  bindInstallation,
  claimRun,
  enqueueRun,
  type FleetState,
  finishRun,
  initialState,
  isLive,
  publicState,
  renewRun,
  requestStop,
  scheduleInbox,
  sweep,
} from "./policy";
import {
  authorizePublication,
  claimPublication,
  reconcilePublications,
  recordPublicationReceipt,
  schedulePublications,
} from "./publication";
import { accessKeyNodeId, createAccessKey, digest, matches, secureOrigin } from "./security";

type NodeRow = {
  id: string;
  owner_id: string;
  name: string;
  gateway_origin: string;
  key_hash: string;
  status: string;
  document: FleetState;
};
type Actor = { id: string; sessionId: string };
// These two broker tables are intentionally SQL-managed, with a versioned JSON
// document. The custom Drizzle migration is their source of truth, not a snapshot.
async function lockNode(tx: DatabaseTransaction, id: string): Promise<NodeRow> {
  const result = await tx.execute(
    sql`SELECT * FROM browser_fleet_node WHERE id = ${id} FOR UPDATE`,
  );
  const row = result.rows[0] as NodeRow | undefined;
  if (!row || row.document.version !== 1) throw new Error("browser_node_unavailable");
  return row;
}
async function save(tx: DatabaseTransaction, row: NodeRow) {
  await tx.execute(sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(row.document)}::jsonb,
    key_hash = ${row.key_hash}, status = ${row.status}, updated_at = now() WHERE id = ${row.id}`);
}
async function audit(tx: DatabaseTransaction, actorId: string, action: string, subjectId: string) {
  await tx.insert(auditEvent).values({
    id: randomUUID(),
    actorType: "system",
    actorId,
    action,
    subjectType: "browser_node",
    subjectId,
    metadata: {},
    occurredAt: new Date(),
  });
}
async function validSession(
  tx: DatabaseTransaction,
  actorId: string,
  sessionId: string | null,
  now: number,
) {
  if (!sessionId) return false;
  const [current] = await tx
    .select({ role: user.role, banned: user.banned })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.userId, actorId),
        gt(session.expiresAt, new Date(now)),
      ),
    );
  return !!current && !current.banned && hasPermission(current.role, "settings:manage");
}
export async function listBrowserNodes(actorId: string) {
  const [owner] = await getDatabase()
    .select({ role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, actorId));
  if (!owner || owner.banned || !hasPermission(owner.role, "settings:manage"))
    throw new Error("owner_revoked");
  const result = await getDatabase().execute(
    sql`SELECT id, name, gateway_origin, status, document FROM browser_fleet_node WHERE owner_id = ${actorId} ORDER BY created_at DESC LIMIT 50`,
  );
  return (result.rows as NodeRow[]).map((n) => ({
    id: n.id,
    name: n.name,
    gatewayOrigin: n.gateway_origin,
    status: n.status,
    ...publicState(n.document),
  }));
}
export type OwnerResult = {
  nodeId?: string;
  accessKey?: string;
  runId?: string;
  connection?: { token: string; origin: string; expiresAt: number };
};
export async function ownerBrowserCommand(input: unknown, actor: Actor): Promise<OwnerResult> {
  const command = ownerCommandSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    if (!(await validSession(tx, actor.id, actor.sessionId, Date.now())))
      throw new Error("owner_session_expired");
    if (command.operation === "create") {
      const count = await tx.execute(
        sql`SELECT id FROM browser_fleet_node WHERE owner_id = ${actor.id}`,
      );
      if (count.rows.length >= 50) throw new Error("node_limit");
      const id = randomUUID();
      const accessKey = createAccessKey(id);
      const { name, gatewayOrigin, ...limits } = command.value;
      await tx.execute(sql`INSERT INTO browser_fleet_node (id, owner_id, name, gateway_origin, key_hash, document)
        VALUES (${id}, ${actor.id}, ${name}, ${secureOrigin(gatewayOrigin)}, ${digest(accessKey)}, ${JSON.stringify(initialState(limits))}::jsonb)`);
      await audit(tx, actor.id, "browser_node.created", id);
      return { nodeId: id, accessKey };
    }
    const nodeId = command.operation === "grant" ? command.value.nodeId : command.nodeId;
    const row = await lockNode(tx, nodeId);
    if (row.owner_id !== actor.id) throw new Error("browser_node_forbidden");
    const state = row.document;
    const now = Date.now();
    let result: {
      accessKey?: string;
      runId?: string;
      connection?: { token: string; origin: string; expiresAt: number };
    } = {};
    if (command.operation === "revoke" || command.operation === "rotate") {
      const key = createAccessKey(row.id);
      row.key_hash = digest(key);
      for (const run of state.runs)
        if (isLive(run) || run.status === "queued") requestStop(state, run);
      row.status = command.operation === "revoke" ? "revoked" : "active";
      if (command.operation === "rotate") result = { accessKey: key };
    } else if (command.operation === "grant") {
      if (row.status !== "active") throw new Error("node_revoked");
      await grant(tx, row, command, actor.id, now);
    } else if (
      command.operation === "account" ||
      command.operation === "confirm-login" ||
      command.operation === "open"
    ) {
      const account = state.accounts.find((a) => a.id === command.accountId);
      if (!account || row.status !== "active") throw new Error("account_unavailable");
      if (command.operation === "account") {
        account.enabled = command.enabled;
        account.credentialVersion++;
        for (const run of state.runs)
          if (run.accountId === account.id && (isLive(run) || run.status === "queued"))
            requestStop(state, run);
      } else if (command.operation === "confirm-login") {
        if (
          state.runs.some(
            (r) => r.accountId === account.id && (isLive(r) || r.status === "unknown"),
          )
        )
          throw new Error("resolve_running_or_unknown_result_first");
        if (!account.proxyCiphertext) throw new Error("proxy_required");
        if (!account.expectedEgressIp) throw new Error("expected_egress_required");
        account.authState = "ready";
      } else {
        if (!account.expectedEgressIp) throw new Error("expected_egress_required");
        const run = enqueueRun(
          state,
          {
            id: randomUUID(),
            accountId: account.id,
            kind: "interactive",
            jobRef: null,
            requestedBy: actor.id,
            authSessionId: actor.sessionId,
          },
          now,
        );
        result = { runId: run.id };
      }
    } else {
      const run = state.runs.find((r) => r.id === command.runId);
      if (!run || (run.kind === "interactive" && run.requestedBy !== actor.id))
        throw new Error("run_forbidden");
      if (command.operation === "stop") requestStop(state, run);
      else {
        if (
          row.status !== "active" ||
          run.kind !== "interactive" ||
          run.status !== "running" ||
          run.stopRequested ||
          run.leaseUntil <= now + 10_000 ||
          run.ticketUsed
        )
          throw new Error("browser_not_connectable");
        const token = `${run.id}.${randomBytes(32).toString("base64url")}`;
        run.ticketHash = digest(token);
        run.connectBefore = Math.min(now + 60_000, run.deadline);
        run.authSessionId = actor.sessionId;
        result = {
          connection: { token, origin: row.gateway_origin, expiresAt: run.connectBefore },
        };
      }
    }
    sweep(state, now);
    await reconcilePublications(tx, row.id, state, now);
    await save(tx, row);
    await audit(tx, actor.id, `browser_node.${command.operation}`, row.id);
    return result;
  });
}
async function grant(
  tx: DatabaseTransaction,
  row: NodeRow,
  command: Extract<OwnerCommand, { operation: "grant" }>,
  actorId: string,
  now: number,
) {
  const { channelRef, accountRef, pollSeconds, credentials: c } = command.value;
  if (
    process.env.SOCIAL_FACEBOOK_WORKER_ENABLED === "1" &&
    process.env.SOCIAL_WORKER_ACCOUNT_REF === accountRef
  )
    throw new Error("disable_legacy_worker_before_binding");
  let account = row.document.accounts.find(
    (a) => a.channelRef === channelRef && a.accountRef === accountRef,
  );
  if (!account) {
    if (row.document.accounts.length >= 100) throw new Error("account_limit");
    // A stable account binding forbids silent reassignment/cookie migration to a second VPS.
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO browser_fleet_binding (id, node_id, account_ref, channel_ref) VALUES (${id}, ${row.id}, ${accountRef}, ${channelRef})`,
    );
    account = {
      id,
      accountRef,
      channelRef,
      enabled: true,
      authState: "needs_login",
      credentialVersion: 0,
      loginCiphertext: null,
      proxyCiphertext: null,
      pollSeconds,
      nextPollAt: now,
      lastCheckedAt: null,
    };
    row.document.accounts.push(account);
  }
  const ring = configuredFacebookKeyring();
  if (c.clearLogin) account.loginCiphertext = null;
  else if (c.loginPassword)
    account.loginCiphertext = encryptFacebookCredential(
      facebookLoginSecretSchema.parse({ username: c.loginUsername, password: c.loginPassword }),
      account,
      "login",
      ring,
    );
  if (c.clearProxy) account.proxyCiphertext = null;
  else if (c.proxyHost)
    account.proxyCiphertext = encryptFacebookCredential(
      facebookProxySecretSchema.parse({
        host: c.proxyHost,
        port: Number(c.proxyPort),
        username: c.proxyUsername,
        password: c.proxyPassword,
      }),
      account,
      "proxy",
      ring,
    );
  if (!account.proxyCiphertext) throw new Error("fixed_proxy_required");
  account.expectedEgressIp = command.value.expectedEgressIp;
  account.pollSeconds = pollSeconds;
  account.credentialVersion++;
  account.authState = "needs_login";
  for (const run of row.document.runs)
    if (run.accountId === account.id && (isLive(run) || run.status === "queued"))
      requestStop(row.document, run);
  await audit(tx, actorId, "browser_account.credentials_updated", account.id);
}
/** Single node row lock serializes capacity reservations across concurrent HTTP
 * polls. Different nodes lock different rows. No in-process mutex is relied on.
 */
export async function handleBrowserNodeRequest(
  accessKey: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const nodeId = accessKeyNodeId(accessKey);
  const request = nodeRequestSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    const row = await lockNode(tx, nodeId);
    if (row.status !== "active" || !matches(accessKey, row.key_hash))
      throw new Error("node_unauthorized");
    const [owner] = await tx
      .select({ role: user.role, banned: user.banned })
      .from(user)
      .where(eq(user.id, row.owner_id));
    if (!owner || owner.banned || !hasPermission(owner.role, "settings:manage"))
      throw new Error("node_owner_revoked");
    const state = row.document;
    const now = Date.now();
    bindInstallation(state, request.installationId);
    let result: Record<string, unknown>;
    if (request.operation === "sync") {
      result = { nodeId, gatewayOrigin: row.gateway_origin, ...publicState(state) };
    } else if (request.operation === "recover") {
      // The agent calls this only after inspecting and stopping all containers
      // labelled with this node id. Expired leases alone never release slots.
      for (const run of state.runs.filter(isLive)) {
        if (!request.stoppedRunIds.includes(run.id)) throw new Error("unconfirmed_old_browser");
        finishRun(state, run.id, run.kind === "publish" ? "unknown" : "failed", true, now);
      }
      state.bootId = request.bootId;
      state.capabilities = [...new Set(request.capabilities)];
      result = { active: true };
    } else {
      if (state.bootId !== request.bootId) throw new Error("stale_node_process");
      result = await nodeOperation(tx, row, request, now);
    }
    state.lastSeenAt = now;
    sweep(state, now);
    await reconcilePublications(tx, row.id, state, now);
    await save(tx, row);
    return { ...result, serverNow: now };
  });
}
async function nodeOperation(
  tx: DatabaseTransaction,
  row: NodeRow,
  request: Exclude<NodeRequest, { operation: "sync" | "recover" }>,
  now: number,
): Promise<Record<string, unknown>> {
  const state = row.document;
  if (request.operation === "claim") {
    // Reject stale interactive requests before reserving memory or disclosing a proxy.
    const waiting = state.runs.filter((r) => r.status === "queued" && r.kind === "interactive");
    const ids = [
      ...new Set(waiting.map((r) => r.authSessionId).filter((id): id is string => !!id)),
    ];
    const valid = ids.length
      ? await tx
          .select({ id: session.id })
          .from(session)
          .where(
            and(
              inArray(session.id, ids),
              eq(session.userId, row.owner_id),
              gt(session.expiresAt, new Date(now)),
            ),
          )
      : [];
    const liveSessions = new Set(valid.map((s) => s.id));
    for (const r of waiting)
      if (!r.authSessionId || !liveSessions.has(r.authSessionId)) requestStop(state, r);
    await schedulePublications(tx, row.id, state, now);
    scheduleInbox(state, now, randomUUID);
    const run = claimRun(state, { ...request, leaseId: randomUUID() }, now);
    if (!run) return { run: null };
    const account = state.accounts.find((a) => a.id === run.accountId);
    if (
      !account?.proxyCiphertext ||
      !account.expectedEgressIp ||
      !account.enabled ||
      account.credentialVersion !== run.credentialVersion
    )
      throw new Error("grant_changed");
    const proxy = facebookProxySecretSchema.parse(
      decryptFacebookCredential(
        account.proxyCiphertext,
        account,
        "proxy",
        configuredFacebookKeyring(),
      ),
    );
    const publication =
      run.kind === "publish" ? await claimPublication(tx, row.id, run, account, now) : null;
    if (run.kind === "publish" && !publication) {
      finishRun(state, run.id, "failed", true, now);
      return { run: null };
    }
    await audit(tx, row.id, "browser_lease.claimed", run.id);
    // Neither login passwords nor platform master keys are part of sync/claim.
    return {
      run: {
        id: run.id,
        kind: run.kind,
        jobRef: run.jobRef,
        ...(publication
          ? { publication, publicationDigest: digestSocialWorkerPayload(publication) }
          : {}),
        accountId: account.id,
        accountRef: account.accountRef,
        channelRef: account.channelRef,
        expectedEgressIp: account.expectedEgressIp,
        leaseId: run.leaseId,
        leaseUntil: run.leaseUntil,
        deadline: run.deadline,
        memoryMb: state.limits.browserMemoryMb,
        proxy,
      },
    };
  }
  if (request.operation === "admit") {
    const run = state.runs.find((r) => request.ticket.startsWith(`${r.id}.`));
    if (
      !run ||
      run.kind !== "interactive" ||
      run.status !== "running" ||
      run.stopRequested ||
      !run.ticketHash ||
      run.connectBefore <= now ||
      run.leaseUntil <= now ||
      run.ticketUsed ||
      !matches(request.ticket, run.ticketHash) ||
      !(await validSession(tx, run.requestedBy, run.authSessionId, now))
    )
      throw new Error("interactive_ticket_invalid");
    run.ticketUsed = true;
    run.ticketHash = null;
    await audit(tx, run.requestedBy, "browser_interactive.connected", run.id);
    return { runId: run.id, expiresAt: run.deadline };
  }
  const run = state.runs.find((r) => r.id === request.runId);
  if (!run || run.leaseId !== request.leaseId) throw new Error("lease_mismatch");
  if (request.operation === "publication-result") {
    const { authorizationId, payloadDigest, outcome, externalPublicationRef, failureCode } =
      request;
    const receipt = {
      authorizationId,
      payloadDigest,
      outcome,
      ...(externalPublicationRef ? { externalPublicationRef } : {}),
      ...(failureCode ? { failureCode } : {}),
    };
    return { receipt: await recordPublicationReceipt(tx, row.id, state, run, receipt, now) };
  }
  if (request.operation === "authorize-publication") {
    const authorization = await authorizePublication(
      tx,
      row.id,
      state,
      run,
      request.payloadDigest,
      now,
    );
    await audit(tx, row.id, "browser_publication.authorized", run.id);
    return { authorization };
  }
  if (request.operation === "finish") {
    finishRun(state, run.id, request.outcome, request.stopped, now);
    await audit(tx, row.id, "browser_lease.stopped", run.id);
    return { active: false };
  }
  if (
    run.kind === "interactive" &&
    !(await validSession(tx, run.requestedBy, run.authSessionId, now))
  )
    requestStop(state, run);
  const renewed = renewRun(state, run.id, request.leaseId, request.ready, now);
  return renewed
    ? {
        active: true,
        leaseUntil: renewed.leaseUntil,
        deadline: renewed.deadline,
        connectBefore: renewed.connectBefore,
      }
    : { active: false };
}
