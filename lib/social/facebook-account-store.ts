import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  facebookAccountRuntime,
  facebookInteractiveSession,
  facebookRequestReceipt,
} from "@/lib/db/facebook-runtime-schema";
import {
  auditEvent,
  session as authSession,
  socialBrowserJob,
  socialChannelControl,
  user,
} from "@/lib/db/schema";
import {
  facebookConnectFormSchema,
  facebookCredentialFormSchema,
  facebookLoginSecretSchema,
  facebookProxySecretSchema,
} from "./facebook-account-forms";
import {
  httpsOrigin,
  type InteractiveEvent,
  signInteractiveTicket,
} from "./facebook-interactive-protocol";
import {
  configuredFacebookKeyring,
  decryptFacebookCredential,
  encryptFacebookCredential,
} from "./facebook-vault-crypto";
import { configuredFacebookWorkerScope } from "./facebook-worker-protocol";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const key = () => process.env.FACEBOOK_INTERACTIVE_SIGNING_KEY ?? "";
const activeSessions = ["issued", "connected"];
const configuredScope = () => configuredFacebookWorkerScope();
async function audit(tx: Tx, actorId: string, action: string, subjectId: string) {
  await tx.insert(auditEvent).values({
    id: randomUUID(),
    action,
    actorType: "human",
    actorId,
    subjectType: "facebook_account",
    subjectId,
    metadata: {},
    occurredAt: new Date(),
  });
}
async function lockControl(tx: Tx) {
  const scope = configuredScope();
  const where = and(
    eq(socialChannelControl.accountRef, scope.accountRef),
    eq(socialChannelControl.channelRef, scope.channelRef),
  );
  const [control] = await tx.select().from(socialChannelControl).where(where).for("update");
  if (!control) throw new Error("请先创建该 Facebook 渠道的控制记录。");
  return { scope, control, where };
}
export async function readFacebookAccountStatus(database: Database = getDatabase()) {
  const scope = configuredScope();
  const [record] = await database
    .select()
    .from(facebookAccountRuntime)
    .where(
      and(
        eq(facebookAccountRuntime.accountRef, scope.accountRef),
        eq(facebookAccountRuntime.channelRef, scope.channelRef),
      ),
    );
  const [control] = await database
    .select({ enabled: socialChannelControl.enabled, status: socialChannelControl.circuitStatus })
    .from(socialChannelControl)
    .where(
      and(
        eq(socialChannelControl.accountRef, scope.accountRef),
        eq(socialChannelControl.channelRef, scope.channelRef),
      ),
    );
  return {
    accountRef: scope.accountRef,
    loginSaved: !!record?.loginCiphertext,
    proxySaved: !!record?.proxyCiphertext,
    authState: record?.authState ?? "disconnected",
    credentialVersion: record?.credentialVersion ?? 0,
    channelActive: !!control?.enabled && control.status === "active",
  };
}
export async function saveFacebookCredentials(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = facebookCredentialFormSchema.parse(input);
  return database.transaction(async (tx) => {
    const { scope, where } = await lockControl(tx);
    const [record] = await tx
      .select()
      .from(facebookAccountRuntime)
      .where(eq(facebookAccountRuntime.accountRef, scope.accountRef))
      .for("update");
    if (record && record.channelRef !== scope.channelRef) throw new Error("账号范围不匹配。");
    const ring = configuredFacebookKeyring();
    const loginCiphertext = value.clearLogin
      ? null
      : value.loginPassword
        ? encryptFacebookCredential(
            facebookLoginSecretSchema.parse({
              username: value.loginUsername,
              password: value.loginPassword,
            }),
            scope,
            "login",
            ring,
          )
        : (record?.loginCiphertext ?? null);
    const proxyCiphertext = value.clearProxy
      ? null
      : value.proxyHost
        ? encryptFacebookCredential(
            facebookProxySecretSchema.parse({
              host: value.proxyHost,
              port: Number(value.proxyPort),
              username: value.proxyUsername,
              password: value.proxyPassword,
            }),
            scope,
            "proxy",
            ring,
          )
        : (record?.proxyCiphertext ?? null);
    await tx
      .insert(facebookAccountRuntime)
      .values({
        ...{ accountRef: scope.accountRef, channelRef: scope.channelRef },
        loginCiphertext,
        proxyCiphertext,
        authState: "disconnected",
        updatedBy: actorId,
      })
      .onConflictDoUpdate({
        target: facebookAccountRuntime.accountRef,
        set: {
          loginCiphertext,
          proxyCiphertext,
          authState: "disconnected",
          credentialVersion: sql`${facebookAccountRuntime.credentialVersion} + 1`,
          updatedBy: actorId,
          updatedAt: new Date(),
        },
      });
    await tx
      .update(facebookInteractiveSession)
      .set({ status: "revoked" })
      .where(
        and(
          eq(facebookInteractiveSession.accountRef, scope.accountRef),
          inArray(facebookInteractiveSession.status, activeSessions),
        ),
      );
    await tx
      .update(socialChannelControl)
      .set({
        circuitStatus: "paused",
        pauseReason: "credentials_changed",
        pauseEvidenceRef: randomUUID(),
        changedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(where);
    await audit(tx, actorId, "facebook_credentials.updated", scope.accountRef);
  });
}
export async function openFacebookInteractive(
  input: unknown,
  actorId: string,
  authSessionId: string,
  database: Database = getDatabase(),
) {
  const value = facebookConnectFormSchema.parse(input);
  const now = Date.now();
  return database.transaction(async (tx) => {
    const { scope, where } = await lockControl(tx);
    const busy = await tx
      .select({ id: socialBrowserJob.id })
      .from(socialBrowserJob)
      .where(
        and(
          eq(socialBrowserJob.accountRef, scope.accountRef),
          eq(socialBrowserJob.channelRef, scope.channelRef),
          eq(socialBrowserJob.status, "claimed"),
        ),
      )
      .limit(1);
    if (busy.length) throw new Error("发布任务尚未结束，请先核对其结果，再连接浏览器。");
    const [runtime] = await tx
      .select()
      .from(facebookAccountRuntime)
      .where(eq(facebookAccountRuntime.accountRef, scope.accountRef));
    if (!runtime || (value.useSavedLogin && !runtime.loginCiphertext))
      throw new Error("请先保存账号凭据，或选择手动登录。");
    await tx
      .update(facebookInteractiveSession)
      .set({ status: "closed" })
      .where(
        and(
          eq(facebookInteractiveSession.accountRef, scope.accountRef),
          inArray(facebookInteractiveSession.status, activeSessions),
          lt(facebookInteractiveSession.expiresAt, new Date(now)),
        ),
      );
    const [existing] = await tx
      .select({ id: facebookInteractiveSession.id })
      .from(facebookInteractiveSession)
      .where(
        and(
          eq(facebookInteractiveSession.accountRef, scope.accountRef),
          inArray(facebookInteractiveSession.status, activeSessions),
        ),
      );
    if (existing) throw new Error("该账号已有连接会话，请先关闭或等待过期。");
    const ticket = {
      version: 1 as const,
      id: randomUUID(),
      ...scope,
      appOrigin: httpsOrigin(process.env.SOCIAL_APP_ORIGIN ?? ""),
      gatewayOrigin: httpsOrigin(process.env.FACEBOOK_INTERACTIVE_ORIGIN ?? ""),
      issuedAt: now,
      connectBefore: now + 60_000,
      expiresAt: now + 600_000,
    };
    const token = signInteractiveTicket(ticket, key());
    await tx
      .update(socialChannelControl)
      .set({
        circuitStatus: "paused",
        pauseReason: "human_login",
        pauseEvidenceRef: ticket.id,
        changedAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(where);
    await tx.insert(facebookInteractiveSession).values({
      id: ticket.id,
      ...scope,
      userId: actorId,
      authSessionId,
      useSavedLogin: value.useSavedLogin,
      connectBefore: new Date(ticket.connectBefore),
      expiresAt: new Date(ticket.expiresAt),
    });
    await audit(tx, actorId, "facebook_interactive.opened", scope.accountRef);
    return { id: ticket.id, token, origin: ticket.gatewayOrigin, expiresAt: ticket.expiresAt };
  });
}
export async function closeFacebookInteractive(
  id: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  const scope = configuredScope();
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(facebookInteractiveSession)
      .where(
        and(
          eq(facebookInteractiveSession.id, id),
          eq(facebookInteractiveSession.userId, actorId),
          eq(facebookInteractiveSession.accountRef, scope.accountRef),
        ),
      )
      .for("update");
    if (!row) throw new Error("会话不存在。");
    // Revocation never releases the worker's filesystem lease; only the gateway
    // releases it after both sockets close. Heartbeats enforce revocation.
    await tx
      .update(facebookInteractiveSession)
      .set({ status: "closed" })
      .where(eq(facebookInteractiveSession.id, id));
    await audit(tx, actorId, "facebook_interactive.closed", scope.accountRef);
  });
}
export async function resumeFacebookAccount(actorId: string, database: Database = getDatabase()) {
  await database.transaction(async (tx) => {
    const { scope, control, where } = await lockControl(tx);
    if (!control.enabled) throw new Error("请先在渠道控制中启用账号。");
    const [verified] = await tx
      .select()
      .from(facebookInteractiveSession)
      .where(
        and(
          eq(facebookInteractiveSession.accountRef, scope.accountRef),
          eq(facebookInteractiveSession.userId, actorId),
          eq(facebookInteractiveSession.status, "closed"),
          eq(facebookInteractiveSession.browserVerified, true),
          gt(facebookInteractiveSession.heartbeatAt, new Date(Date.now() - 120_000)),
        ),
      )
      .orderBy(desc(facebookInteractiveSession.heartbeatAt))
      .limit(1);
    const [active] = await tx
      .select({ id: facebookInteractiveSession.id })
      .from(facebookInteractiveSession)
      .where(
        and(
          eq(facebookInteractiveSession.accountRef, scope.accountRef),
          inArray(facebookInteractiveSession.status, activeSessions),
          gt(facebookInteractiveSession.expiresAt, new Date()),
        ),
      );
    const [pending] = await tx
      .select({ id: socialBrowserJob.id })
      .from(socialBrowserJob)
      .where(
        and(
          eq(socialBrowserJob.accountRef, scope.accountRef),
          inArray(socialBrowserJob.status, ["claimed", "paused"]),
        ),
      );
    if (!verified || active || pending)
      throw new Error("请完成账号校验并关闭连接；未知结果或暂停任务必须先人工处理。");
    await tx
      .update(socialChannelControl)
      .set({
        circuitStatus: "active",
        pauseReason: null,
        pauseEvidenceRef: null,
        changedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(where);
    await audit(tx, actorId, "facebook_interactive.resumed", scope.accountRef);
  });
}
/** Gateway-only callback. Fresh signed request, durable replay rejection, and
 * the original live application session are required even after WS upgrade.
 */
export async function handleFacebookInteractiveEvent(
  event: InteractiveEvent,
  database: Database = getDatabase(),
) {
  return database.transaction(async (tx) => {
    const scope = configuredScope();
    const now = new Date();
    const [row] = await tx
      .select()
      .from(facebookInteractiveSession)
      .where(
        and(
          eq(facebookInteractiveSession.id, event.id),
          eq(facebookInteractiveSession.workerId, scope.workerId),
          eq(facebookInteractiveSession.accountRef, scope.accountRef),
          eq(facebookInteractiveSession.channelRef, scope.channelRef),
        ),
      )
      .for("update");
    if (!row || row.expiresAt <= now || !activeSessions.includes(row.status))
      return { active: false };
    const [login] = await tx
      .select({ id: user.id, role: user.role, banned: user.banned })
      .from(authSession)
      .innerJoin(user, eq(user.id, authSession.userId))
      .where(
        and(
          eq(authSession.id, row.authSessionId),
          eq(authSession.userId, row.userId),
          gt(authSession.expiresAt, now),
        ),
      );
    if (
      !login ||
      login.banned ||
      login.role !== "admin" ||
      login.id !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID
    )
      return { active: false };
    const claimed = await tx
      .insert(facebookRequestReceipt)
      .values({ requestId: event.requestId, expiresAt: new Date(Date.now() + 600_000) })
      .onConflictDoNothing()
      .returning({ id: facebookRequestReceipt.requestId });
    if (!claimed.length) throw new Error("interactive_event_replayed");
    await tx.delete(facebookRequestReceipt).where(lt(facebookRequestReceipt.expiresAt, now));
    if (event.operation === "claim") {
      if (row.status !== "issued" || row.connectBefore <= now) return { active: false };
      await tx
        .update(facebookInteractiveSession)
        .set({ status: "connected", heartbeatAt: now })
        .where(eq(facebookInteractiveSession.id, row.id));
      return { active: true, expiresAt: row.expiresAt.getTime(), useSavedLogin: row.useSavedLogin };
    }
    if (row.status !== "connected") return { active: false };
    if (event.operation === "close") {
      await tx
        .update(facebookInteractiveSession)
        .set({ status: "closed" })
        .where(eq(facebookInteractiveSession.id, row.id));
      return { active: false };
    }
    if (event.operation === "login") {
      if (!row.useSavedLogin || row.credentialClaimed)
        throw new Error("interactive_login_not_authorized");
      const [record] = await tx
        .select()
        .from(facebookAccountRuntime)
        .where(eq(facebookAccountRuntime.accountRef, scope.accountRef));
      if (!record?.loginCiphertext || record.channelRef !== scope.channelRef)
        throw new Error("credential_missing");
      const credential = facebookLoginSecretSchema.parse(
        decryptFacebookCredential(
          record.loginCiphertext,
          scope,
          "login",
          configuredFacebookKeyring(),
        ),
      );
      await tx
        .update(facebookInteractiveSession)
        .set({ credentialClaimed: true })
        .where(eq(facebookInteractiveSession.id, row.id));
      await audit(tx, row.userId, "facebook_credentials.login_used", scope.accountRef);
      return { active: true, credential };
    }
    if (event.operation === "attention" || event.operation === "verified") {
      if (event.operation === "attention" && !event.state)
        throw new Error("interactive_attention_state_missing");
      await tx
        .update(facebookAccountRuntime)
        .set({ authState: event.operation === "verified" ? "ready" : event.state, updatedAt: now })
        .where(eq(facebookAccountRuntime.accountRef, scope.accountRef));
      await tx
        .update(facebookInteractiveSession)
        .set({ browserVerified: event.operation === "verified", heartbeatAt: now })
        .where(eq(facebookInteractiveSession.id, row.id));
    } else
      await tx
        .update(facebookInteractiveSession)
        .set({ heartbeatAt: now })
        .where(eq(facebookInteractiveSession.id, row.id));
    return { active: true };
  });
}
