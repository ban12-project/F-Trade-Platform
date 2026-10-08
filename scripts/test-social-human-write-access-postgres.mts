import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import {
  facebookAccountRuntime,
  facebookInteractiveSession,
  facebookPublicationManifest,
  facebookRequestReceipt,
} from "../lib/db/facebook-runtime-schema";
import { productMediaAsset } from "../lib/db/product-media-schema";
import * as s from "../lib/db/schema";
import {
  authorizeSocialActor,
  authorizeSocialProject,
  SOCIAL_HUMAN_ACCESS_MESSAGE,
  SocialHumanAccessError,
  type SocialProjectIdentity,
} from "../lib/social/human-write-access";
import {
  seedPublicationAccessFixture,
  syntheticPublicationBytes,
} from "../tests/fixtures/publication-access";

const connection = process.env.SOCIAL_HUMAN_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
process.env.FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID = "synthetic";
process.env.FACEBOOK_CREDENTIAL_KEYS_JSON = JSON.stringify({
  synthetic: Buffer.alloc(32, 3).toString("base64"),
});
const interactiveSigningKey = Buffer.alloc(32, 7).toString("base64");
process.env.FACEBOOK_INTERACTIVE_SIGNING_KEY = interactiveSigningKey;
process.env.SOCIAL_APP_ORIGIN = "https://synthetic-platform.example.invalid";
process.env.FACEBOOK_INTERACTIVE_ORIGIN = "https://synthetic-browser.example.invalid";
process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "1";
globalThis.fetch = async () => {
  throw Error("Outbound forbidden in social authorization tests");
};
const db = getDatabase(),
  pool = new Pool({ connectionString: connection });
let postCommitFailure = false;
let current:
    | { user: typeof s.user.$inferSelect; session: typeof s.session.$inferSelect }
    | undefined,
  deliveries = 0,
  blobBarrier: (() => Promise<void>) | undefined;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", {
  exports: {
    revalidatePath: () => {
      if (postCommitFailure) throw Error("SYNTHETIC private cache failure");
    },
    refresh: () => {},
  },
});
mock.module("next/server", {
  exports: {
    after: () => {
      deliveries++;
      if (postCommitFailure) throw Error("SYNTHETIC private scheduling failure");
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: async () => current } } },
});
mock.module("@vercel/blob", {
  exports: {
    get: async () => {
      await blobBarrier?.();
      return {
        statusCode: 200,
        stream: new ReadableStream({
          start(c) {
            c.enqueue(syntheticPublicationBytes);
            c.close();
          },
        }),
      };
    },
    put: async () => {
      throw Error("Blob writes forbidden");
    },
    del: async () => {
      throw Error("Blob deletion forbidden");
    },
  },
});
const { confirmPublicationAction } = await import("../lib/actions/closing");
const { submitFacebookMediaAction } = await import("../lib/actions/facebook-media");
const { saveSocialChannelControlAction } = await import("../lib/actions/social-controls");
const { reconcilePublicationAction, reconcileVideoPublicationAction } = await import(
  "../lib/actions/publication-reconciliation"
);
const accountActions = await import("../lib/actions/facebook-account");
const { submitControlledPublication } = await import("../lib/social/publication-store");
const { submitFacebookMediaPublication } = await import("../lib/social/facebook-media-store");
const { saveSocialChannelControl } = await import("../lib/social/control-store");
const { reconcileUnknownTextPublication, reconcileUnknownVideoPublication } = await import(
  "../lib/social/publication-reconciliation"
);
const accountStore = await import("../lib/social/facebook-account-store");
type Fixture = Awaited<ReturnType<typeof seedPublicationAccessFixture>>;
const operations = [
  "text",
  "image",
  "video",
  "reconcile-text",
  "reconcile-video",
  "enable",
  "pause",
  "resume",
  "credentials",
  "connect",
  "disconnect",
  "account-resume",
] as const;
type Operation = (typeof operations)[number];
async function fixture(op: Operation) {
  const format = op.includes("video") ? "video" : op === "image" ? "image" : "text";
  const f = await seedPublicationAccessFixture(db, format, op.startsWith("reconcile"));
  const [actor] = await db.select().from(s.user).where(eq(s.user.id, f.actorId));
  const [session] = await db.select().from(s.session).where(eq(s.session.id, f.sessionId));
  current = { user: actor, session };
  process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = f.actorId;
  process.env.SOCIAL_WORKER_ID = "synthetic-worker";
  process.env.SOCIAL_WORKER_CHANNEL_REF = f.channelRef;
  process.env.SOCIAL_WORKER_ACCOUNT_REF = f.accountRef;
  if (["enable", "resume", "account-resume"].includes(op))
    await db
      .update(s.socialChannelControl)
      .set({
        circuitStatus: "paused",
        enabled: op === "account-resume",
        pauseReason: "manual_pause",
        pauseEvidenceRef: "evidence-synthetic-pause",
      })
      .where(eq(s.socialChannelControl.accountRef, f.accountRef));
  return f;
}
const credentials = {
  loginUsername: "synthetic-only",
  loginPassword: "synthetic-not-real",
  proxyHost: "",
  proxyPort: "",
  proxyUsername: "",
  proxyPassword: "",
  clearLogin: false,
  clearProxy: false,
};
function form(value: Record<string, unknown>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(value)) f.set(k, String(v));
  return f;
}
function controlInput(f: Fixture, op: Operation) {
  return {
    channelRef: f.channelRef,
    accountRef: f.accountRef,
    action: op,
    actorType: "human",
    actorId: f.actorId,
    evidenceRef: "evidence-synthetic-control",
  };
}
const initial = { status: "idle" as const, message: "" };
function run(op: Operation, f: Fixture) {
  if (op === "text") return confirmPublicationAction(initial, form(f.submission));
  if (op === "image" || op === "video") return submitFacebookMediaAction(f.mediaSubmission);
  if (op === "reconcile-text") return reconcilePublicationAction(f.reconciliation);
  if (op === "reconcile-video") return reconcileVideoPublicationAction(f.reconciliation);
  if (op === "credentials") return accountActions.saveFacebookCredentialsAction(credentials);
  if (op === "connect")
    return accountActions.openFacebookInteractiveAction({ useSavedLogin: false });
  if (op === "disconnect") return accountActions.closeFacebookInteractiveAction(f.interactiveId);
  if (op === "account-resume") return accountActions.resumeFacebookAccountAction();
  return saveSocialChannelControlAction(initial, form(controlInput(f, op)));
}
function success(r: Awaited<ReturnType<typeof run>>) {
  return "ok" in r ? r.ok : r.status === "success";
}
async function snapshot(f: Fixture) {
  const [
    publications,
    jobs,
    manifests,
    content,
    gates,
    audits,
    controls,
    runtime,
    interactive,
    receipt,
  ] = await Promise.all([
    db.select().from(s.socialPublication).where(eq(s.socialPublication.projectId, f.projectId)),
    db.select().from(s.socialBrowserJob).where(eq(s.socialBrowserJob.accountRef, f.accountRef)),
    db
      .select()
      .from(facebookPublicationManifest)
      .innerJoin(
        s.socialPublication,
        eq(s.socialPublication.id, facebookPublicationManifest.publicationId),
      )
      .where(eq(s.socialPublication.projectId, f.projectId)),
    db.select().from(s.aggregateRecord).where(eq(s.aggregateRecord.id, f.contentId)),
    db.select().from(s.approval).where(eq(s.approval.id, f.gateId)),
    db.select().from(s.auditEvent).where(eq(s.auditEvent.actorId, f.actorId)),
    db
      .select()
      .from(s.socialChannelControl)
      .where(eq(s.socialChannelControl.accountRef, f.accountRef)),
    db
      .select()
      .from(facebookAccountRuntime)
      .where(eq(facebookAccountRuntime.accountRef, f.accountRef)),
    db
      .select()
      .from(facebookInteractiveSession)
      .where(eq(facebookInteractiveSession.accountRef, f.accountRef)),
    db.execute(sql`SELECT * FROM browser_fleet_publication WHERE job_id=${f.jobId}`),
  ]);
  return {
    publications,
    jobs,
    manifests,
    content,
    gates,
    audits,
    controls,
    runtime,
    interactive,
    receipt: receipt.rows,
  };
}
async function observeWait(pid: number) {
  const deadline = performance.now() + 5000;
  for (;;) {
    const {
      rows: [{ blocked }],
    } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (blocked) return;
    assert(performance.now() < deadline, "Observe actual source/authorization lock wait");
    await delay(10);
  }
}
async function lock(op: Operation, f: Fixture, kind?: string) {
  const c = await pool.connect();
  await c.query("BEGIN");
  const {
    rows: [{ pid }],
  } = await c.query("SELECT pg_backend_pid() AS pid");
  if (kind === "reference" && !op.startsWith("reconcile"))
    await c.query("SELECT id FROM social_channel_control WHERE account_ref=$1 FOR UPDATE", [
      f.accountRef,
    ]);
  else if (op === "text" || op === "video")
    await c.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [f.contentId]);
  else if (op === "image")
    await c.query("SELECT id FROM product_media_asset WHERE id=$1 FOR UPDATE", [f.mediaId]);
  else if (op.startsWith("reconcile"))
    await c.query("SELECT id FROM browser_fleet_node WHERE id=$1 FOR UPDATE", [f.nodeId]);
  else if (op === "disconnect")
    await c.query("SELECT id FROM facebook_interactive_session WHERE id=$1 FOR UPDATE", [
      f.interactiveId,
    ]);
  else
    await c.query("SELECT id FROM social_channel_control WHERE account_ref=$1 FOR UPDATE", [
      f.accountRef,
    ]);
  return { c, pid };
}
const changes = [
  "revoked",
  "demoted",
  "banned",
  "expired",
  "natural-expiry",
  "wrong-session",
] as const;
async function change(f: Fixture, kind: string, op?: Operation) {
  if (kind === "revoked") await db.delete(s.session).where(eq(s.session.id, f.sessionId));
  if (kind === "demoted")
    await db
      .update(s.user)
      .set({ role: op === "text" ? "invalid" : "user" })
      .where(eq(s.user.id, f.actorId));
  if (kind === "banned")
    await db.update(s.user).set({ banned: true }).where(eq(s.user.id, f.actorId));
  if (kind === "expired" || kind === "natural-expiry")
    await db
      .update(s.session)
      .set({ expiresAt: new Date(Date.now() + (kind === "natural-expiry" ? 100 : -1)) })
      .where(eq(s.session.id, f.sessionId));
  if (kind === "wrong-session")
    await db.update(s.session).set({ userId: f.ownerId }).where(eq(s.session.id, f.sessionId));
  if (kind === "viewer")
    await db
      .update(s.workspaceProjectMember)
      .set({ role: "viewer" })
      .where(
        and(
          eq(s.workspaceProjectMember.projectId, f.projectId),
          eq(s.workspaceProjectMember.userId, f.actorId),
        ),
      );
  if (kind === "removed")
    await db
      .delete(s.workspaceProjectMember)
      .where(
        and(
          eq(s.workspaceProjectMember.projectId, f.projectId),
          eq(s.workspaceProjectMember.userId, f.actorId),
        ),
      );
  if (kind === "reference")
    await db
      .update(s.workspaceProjectItem)
      .set({ relation: "reference", role: "product_reference" })
      .where(eq(s.workspaceProjectItem.aggregateId, f.contentId));
  if (kind === "rights-expired")
    await db
      .update(productMediaAsset)
      .set({ rightsExpiresAt: new Date(Date.now() + 100) })
      .where(eq(productMediaAsset.id, f.mediaId));
  if (kind === "owner-changed") process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = f.ownerId;
}
let count = 0;
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "drizzle" });
  for (const op of operations) {
    console.log(`Checking ${op}`);
    const f = await fixture(op);
    const before = await snapshot(f);
    const r = await run(op, f);
    assert(success(r), `${op} allowed current request: ${JSON.stringify(r)}`);
    const after = await snapshot(f);
    assert.notDeepEqual(after, before, `${op} must execute real business write`);
    count++;
    if (op.startsWith("reconcile")) {
      assert.deepEqual(after.receipt, before.receipt, "Original unknown receipt remains immutable");
      assert.equal(after.controls[0].circuitStatus, "paused");
      assert.equal(after.publications[0].publishedAt, null);
      const replay = await run(op, f);
      assert(success(replay));
      assert.deepEqual(await snapshot(f), after);
      count++;
    }
    for (const kind of changes) {
      const f = await fixture(op);
      const held = await lock(op, f);
      const d = deliveries;
      const pending = run(op, f);
      await observeWait(held.pid);
      await change(f, kind, op);
      if (kind === "natural-expiry") await delay(130);
      const before = await snapshot(f);
      await held.c.query("COMMIT");
      held.c.release();
      const r = await pending;
      assert(!success(r), `${op}/${kind} denied`);
      assert.equal(
        "message" in r ? r.message : undefined,
        SOCIAL_HUMAN_ACCESS_MESSAGE,
        `${op}/${kind} controlled authorization failure`,
      );
      assert.deepEqual(await snapshot(f), before, `${op}/${kind} zero business writes`);
      assert.equal(deliveries, d, "Denied request schedules no delivery");
      count++;
    }
  }
  for (const op of ["text", "image", "video", "reconcile-text", "reconcile-video"] as const) {
    for (const kind of ["viewer", "removed", "reference"]) {
      const f = await fixture(op),
        held = await lock(op, f, kind);
      const pending = run(op, f);
      await observeWait(held.pid);
      await change(f, kind, op);
      const before = await snapshot(f);
      await held.c.query("COMMIT");
      held.c.release();
      assert(!success(await pending), `${op}/${kind} denies current project access`);
      assert.deepEqual(await snapshot(f), before);
      count++;
    }
  }
  // Cache/scheduling failure after commit must not report a failed business submission.
  for (const op of [
    "text",
    "image",
    "video",
    "reconcile-text",
    "reconcile-video",
    "pause",
  ] as const) {
    const f = await fixture(op),
      before = await snapshot(f);
    postCommitFailure = true;
    const result = await run(op, f);
    postCommitFailure = false;
    assert(success(result));
    assert.notDeepEqual(await snapshot(f), before);
    count++;
  }
  // Normal business writers remain allowed to confirm text; approval is still independent.
  {
    const f = await fixture("text");
    await db.update(s.user).set({ role: "user" }).where(eq(s.user.id, f.actorId));
    current.user.role = "user";
    assert(success(await run("text", f)));
    count++;
  }
  // Session/project identities are server-scoped, never client substitutes.
  {
    const f = await fixture("text"),
      before = await snapshot(f);
    for (const wrong of [
      { ...f.identity, projectId: randomUUID() },
      { ...f.identity, sessionId: randomUUID() },
      { ...f.identity, actorId: f.ownerId },
    ]) {
      await assert.rejects(() => submitControlledPublication(f.submission, wrong, db));
      assert.deepEqual(await snapshot(f), before);
      count++;
    }
  }
  // Concurrent confirmation commits exactly one durable publication, job and audit.
  for (const op of ["text", "image", "video"] as const) {
    const f = await fixture(op);
    const invoke = () =>
      op === "text"
        ? submitControlledPublication(f.submission, f.identity, db)
        : submitFacebookMediaPublication(f.mediaSubmission, f.identity, db);
    const r = await Promise.all(Array.from({ length: 3 }, invoke));
    assert.deepEqual(r[0], r[1]);
    assert.deepEqual(r[1], r[2]);
    const saved = await snapshot(f);
    assert.equal(saved.publications.length, 1);
    assert.equal(saved.jobs.length, 1);
    assert.equal(saved.audits.length, 1);
    count++;
  }
  // A media grant expires naturally while waiting for the current actor's row.
  {
    const f = await fixture("image"),
      held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM product_media_asset WHERE id=$1 FOR UPDATE", [f.mediaId]);
    const pending = run("image", f);
    await observeWait(pid);
    await held.query("UPDATE product_media_asset SET rights_expires_at=$1 WHERE id=$2", [
      new Date(Date.now() + 100),
      f.mediaId,
    ]);
    await delay(130);
    const before = await snapshot(f);
    await held.query("COMMIT");
    held.release();
    assert(!success(await pending));
    assert.deepEqual(await snapshot(f), before);
    count++;
  }
  // Private-video verification may outlive its current authorized owner.
  for (const kind of ["revoked", "banned", "owner-changed"]) {
    const f = await fixture("video");
    let reached!: () => void, release!: () => void;
    const seen = new Promise<void>((r) => (reached = r)),
      wait = new Promise<void>((r) => (release = r));
    blobBarrier = async () => {
      reached();
      await wait;
    };
    const pending = run("video", f);
    await seen;
    await change(f, kind, "video");
    const before = await snapshot(f);
    release();
    assert(!success(await pending));
    assert.deepEqual(await snapshot(f), before);
    blobBarrier = undefined;
    count++;
  }
  // Expiry while the final audit waits must roll back earlier writes as one transaction.
  for (const op of operations) {
    const f = await fixture(op);
    const trigger = `synthetic_social_expiry_${randomUUID().replaceAll("-", "")}`;
    const key = Date.now();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id = '${f.actorId}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}();`,
      ),
    );
    const held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
    try {
      const expires = new Date(Date.now() + 900);
      await db.update(s.session).set({ expiresAt: expires }).where(eq(s.session.id, f.sessionId));
      const before = await snapshot(f),
        d = deliveries;
      const pending = run(op, f);
      await observeWait(pid);
      await delay(Math.max(0, expires.getTime() - Date.now() + 10));
      await held.query("COMMIT");
      assert(!success(await pending), `${op} expiry after earlier transactional writes`);
      assert.deepEqual(await snapshot(f), before, `${op} expiry rolls back all prior writes`);
      assert.equal(deliveries, d);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
      await db.execute(
        sql.raw(`DROP TRIGGER ${trigger} ON audit_event; DROP FUNCTION ${trigger}();`),
      );
    }
  }
  // Media publication requires the complete verified manifest path, never a legacy generic job.
  for (const format of ["image", "video"] as const) {
    const f = await fixture(format),
      before = await snapshot(f),
      d = deliveries;
    const response = await confirmPublicationAction(initial, form(f.submission));
    assert(!success(response));
    assert.equal(response.message, "图片和视频请在素材发布区域核对素材与目标账户后提交。");
    assert.deepEqual(await snapshot(f), before);
    assert.equal(deliveries, d);
    count++;
  }
  // Natural media-right expiry during final audit rolls back the publication and manifest.
  {
    const f = await fixture("image"),
      trigger = `synthetic_media_expiry_${randomUUID().replaceAll("-", "")}`,
      key = Date.now();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='${f.actorId}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}();`,
      ),
    );
    const held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
    try {
      const expires = new Date(Date.now() + 900);
      await db
        .update(productMediaAsset)
        .set({ rightsExpiresAt: expires })
        .where(eq(productMediaAsset.id, f.mediaId));
      const before = await snapshot(f),
        d = deliveries;
      const pending = run("image", f);
      await observeWait(pid);
      await delay(Math.max(0, expires.getTime() - Date.now() + 10));
      await held.query("COMMIT");
      assert(!success(await pending));
      assert.deepEqual(await snapshot(f), before);
      assert.equal(deliveries, d);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
      await db.execute(
        sql.raw(`DROP TRIGGER ${trigger} ON audit_event; DROP FUNCTION ${trigger}();`),
      );
    }
  }
  // Domain APIs cannot accept legacy actor-only calls or crossed project/session identities.
  for (const op of operations) {
    const f = await fixture(op);
    const invalid = f.actorId as unknown as SocialProjectIdentity;
    const before = await snapshot(f);
    const direct =
      op === "text"
        ? () => submitControlledPublication(f.submission, invalid, db)
        : op === "image" || op === "video"
          ? () => submitFacebookMediaPublication(f.mediaSubmission, invalid, db)
          : op === "reconcile-text"
            ? () => reconcileUnknownTextPublication(f.reconciliation, invalid, db)
            : op === "reconcile-video"
              ? () => reconcileUnknownVideoPublication(f.reconciliation, invalid, db)
              : op === "credentials"
                ? () => accountStore.saveFacebookCredentials(credentials, invalid, db)
                : op === "connect"
                  ? () =>
                      accountStore.openFacebookInteractive({ useSavedLogin: false }, invalid, db)
                  : op === "disconnect"
                    ? () => accountStore.closeFacebookInteractive(f.interactiveId, invalid, db)
                    : op === "account-resume"
                      ? () => accountStore.resumeFacebookAccount(invalid, db)
                      : () => saveSocialChannelControl(controlInput(f, op), invalid, db);
    await assert.rejects(direct, SocialHumanAccessError);
    assert.deepEqual(await snapshot(f), before);
    count++;
  }
  // Current authorization is held until commit, rather than merely sampled.
  {
    const f = await fixture("text"),
      writer = await pool.connect();
    await writer.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await writer.query("SELECT pg_backend_pid() AS pid");
    let pending: ReturnType<typeof writer.query> | undefined;
    await db.transaction(async (tx) => {
      await authorizeSocialProject(tx, f.identity, "write", f.contentId, "text");
      await authorizeSocialActor(tx, f.identity, ["content:write"]);
      pending = writer.query("DELETE FROM session WHERE id=$1", [f.sessionId]);
      const deadline = performance.now() + 5000;
      for (;;) {
        const {
          rows: [{ blocked }],
        } = await pool.query("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked", [pid]);
        if (blocked) break;
        assert(performance.now() < deadline);
        await delay(10);
      }
    });
    await pending;
    await writer.query("ROLLBACK");
    writer.release();
    count++;
  }
  // Signed gateway callbacks must use the same current session after interactive-row waits.
  const { POST: interactiveCallback } = await import(
    "../app/api/social-worker/facebook/interactive/route"
  );
  const { signInteractiveEvent } = await import("../lib/social/facebook-interactive-protocol");
  for (const operation of [
    "claim",
    "heartbeat",
    "close",
    "login",
    "attention",
    "verified",
  ] as const) {
    for (const kind of [
      "unchanged",
      "revoked",
      "demoted",
      "banned",
      "wrong-session",
      "natural-expiry",
      "interactive-expiry",
    ] as const) {
      const f = await fixture("connect");
      if (operation === "login")
        await accountStore.saveFacebookCredentials(
          credentials,
          { actorId: f.actorId, sessionId: f.sessionId },
          db,
        );
      await db
        .update(facebookInteractiveSession)
        .set({
          status: operation === "claim" ? "issued" : "connected",
          useSavedLogin: operation === "login",
        })
        .where(eq(facebookInteractiveSession.id, f.interactiveId));
      const held = await pool.connect();
      await held.query("BEGIN");
      const {
        rows: [{ pid }],
      } = await held.query("SELECT pg_backend_pid() AS pid");
      await held.query("SELECT id FROM facebook_interactive_session WHERE id=$1 FOR UPDATE", [
        f.interactiveId,
      ]);
      const requestId = randomUUID();
      const event = {
        operation,
        id: f.interactiveId,
        requestId,
        at: Date.now(),
        ...(operation === "attention" ? { state: "login_required" as const } : {}),
      };
      const pending = interactiveCallback(
        new Request(
          "https://synthetic-platform.example.invalid/api/social-worker/facebook/interactive",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(signInteractiveEvent(event, interactiveSigningKey)),
          },
        ),
      );
      await observeWait(pid);
      const interactiveExpiry = new Date(Date.now() + 100);
      if (kind === "interactive-expiry")
        await held.query("UPDATE facebook_interactive_session SET expires_at=$1 WHERE id=$2", [
          new Date(Date.now() + 100),
          f.interactiveId,
        ]);
      else if (kind !== "unchanged") await change(f, kind, "connect");
      if (kind === "natural-expiry" || kind === "interactive-expiry") await delay(130);
      const before = await snapshot(f);
      if (kind === "interactive-expiry") {
        const row = before.interactive.find((row) => row.id === f.interactiveId);
        assert(row);
        row.expiresAt = interactiveExpiry;
      }
      await held.query("COMMIT");
      held.release();
      const response = await pending;
      const body = await response.json();
      const receipts = await db
        .select()
        .from(facebookRequestReceipt)
        .where(eq(facebookRequestReceipt.requestId, requestId));
      if (kind === "unchanged") {
        assert.equal(response.status, 200);
        assert.equal(body.active, operation !== "close");
        assert.equal(receipts.length, 1);
        assert.notDeepEqual(await snapshot(f), before);
      } else {
        assert.equal(body.active, false);
        assert.equal(receipts.length, 0);
        assert.deepEqual(
          await snapshot(f),
          before,
          "Denied signed callback preserves credentials, runtime, connection and receipts",
        );
      }
      count++;
    }
  }
  // Callback authorization can expire after request-receipt work begins; all writes roll back.
  for (const operation of [
    "claim",
    "heartbeat",
    "close",
    "login",
    "attention",
    "verified",
  ] as const) {
    const f = await fixture("connect");
    if (operation === "login")
      await accountStore.saveFacebookCredentials(
        credentials,
        { actorId: f.actorId, sessionId: f.sessionId },
        db,
      );
    await db
      .update(facebookInteractiveSession)
      .set({
        status: operation === "claim" ? "issued" : "connected",
        useSavedLogin: operation === "login",
      })
      .where(eq(facebookInteractiveSession.id, f.interactiveId));
    const trigger = `synthetic_callback_expiry_${randomUUID().replaceAll("-", "")}`,
      key = Date.now(),
      requestId = randomUUID();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${requestId}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON facebook_request_receipt FOR EACH ROW EXECUTE FUNCTION ${trigger}();`,
      ),
    );
    const held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
    try {
      const expires = new Date(Date.now() + 900);
      await db.update(s.session).set({ expiresAt: expires }).where(eq(s.session.id, f.sessionId));
      const before = await snapshot(f);
      const event = {
        operation,
        id: f.interactiveId,
        requestId,
        at: Date.now(),
        ...(operation === "attention" ? { state: "login_required" as const } : {}),
      };
      const pending = interactiveCallback(
        new Request(
          "https://synthetic-platform.example.invalid/api/social-worker/facebook/interactive",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(signInteractiveEvent(event, interactiveSigningKey)),
          },
        ),
      );
      await observeWait(pid);
      await delay(Math.max(0, expires.getTime() - Date.now() + 10));
      await held.query("COMMIT");
      const response = await pending;
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { active: false });
      assert.deepEqual(await snapshot(f), before);
      assert.equal(
        (
          await db
            .select()
            .from(facebookRequestReceipt)
            .where(eq(facebookRequestReceipt.requestId, requestId))
        ).length,
        0,
      );
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
      await db.execute(
        sql.raw(`DROP TRIGGER ${trigger} ON facebook_request_receipt; DROP FUNCTION ${trigger}();`),
      );
    }
  }
  console.log(
    `PASS ${count} actual social human authorization cases; current roles/sessions, observed lock waits, media reads, atomic denial, unknown receipts, idempotency and reservation; no external delivery`,
  );
} finally {
  await closeDatabase();
  await pool.end();
}
