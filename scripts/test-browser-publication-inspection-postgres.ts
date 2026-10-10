import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { claimRun, enqueueRun, initialState } from "../lib/browser-fleet/policy";
import { inspectOwnedPublicationPage } from "../lib/browser-fleet/publication-page-inspection";
import type { BrowserSandboxProvider } from "../lib/browser-fleet/sandbox-provider";
import { ownerBrowserCommand } from "../lib/browser-fleet/store";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { auditEvent, session, user } from "../lib/db/schema";

const connection = process.env.BROWSER_FLEET_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/browser_fleet_test"
)
  throw Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw Error("External network forbidden");
};
const db = getDatabase();
async function fixture() {
  const actor = { id: randomUUID(), sessionId: randomUUID() },
    otherOwner = randomUUID(),
    nodeId = randomUUID(),
    accountId = randomUUID(),
    runId = randomUUID();
  await db.insert(user).values({
    id: actor.id,
    name: "SYNTHETIC page reviewer",
    email: `${actor.id}@example.invalid`,
    role: "admin",
  });
  await db.insert(user).values({
    id: otherOwner,
    name: "SYNTHETIC other owner",
    email: `${otherOwner}@example.invalid`,
    role: "user",
  });
  await db.insert(session).values({
    id: actor.sessionId,
    userId: actor.id,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
  state.capabilities = ["interactive"];
  state.accounts.push({
    id: accountId,
    channelRef: "synthetic-facebook",
    accountRef: "synthetic-account",
    expectedEgressIp: "203.0.113.10",
    enabled: true,
    authState: "ready",
    credentialVersion: 1,
    loginCiphertext: null,
    proxyCiphertext: null,
    pollSeconds: 0,
    nextPollAt: 0,
    lastCheckedAt: null,
  });
  enqueueRun(
    state,
    {
      id: runId,
      accountId,
      kind: "interactive",
      jobRef: null,
      requestedBy: actor.id,
      authSessionId: actor.sessionId,
    },
    Date.now(),
  );
  const run = claimRun(
    state,
    { requestId: randomUUID(), leaseId: randomUUID(), availableMemoryMb: 8192, localSlots: 1 },
    Date.now(),
  );
  assert(run);
  run.status = "running";
  await db.execute(
    sql`INSERT INTO browser_fleet_node(id,owner_id,name,gateway_origin,key_hash,document) VALUES (${nodeId},${actor.id},'SYNTHETIC page review','https://synthetic-node.vercel.run',${createHash("sha256").update(randomUUID()).digest("hex")},${JSON.stringify(state)}::jsonb)`,
  );
  await db.execute(
    sql`INSERT INTO browser_sandbox(node_id,sandbox_name,phase,session_id) VALUES (${nodeId},${`ftrade-browser-${nodeId}`},'running','synthetic-session')`,
  );
  return { actor, otherOwner, nodeId, runId, state };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function save(f: Fixture) {
  await db.execute(
    sql`UPDATE browser_fleet_node SET document=${JSON.stringify(f.state)}::jsonb WHERE id=${f.nodeId}`,
  );
}
const observation = () => ({
  version: 1,
  observedAt: new Date().toISOString(),
  candidateHash: "a".repeat(64),
  candidateExpiresAt: "2000-01-01T00:00:00Z",
  candidateExpired: true,
  identityMatched: true,
  controls: {
    identity: 1,
    openComposer: 1,
    composer: 1,
    textbox: 1,
    submit: 1,
    audience: 1,
    fileInput: 1,
    attachmentName: 0,
  },
  composerIdentityMatched: true,
  composerEmpty: true,
  audienceMatchesCandidate: true,
  videoPreviewCount: 0,
  videoReceiptVisible: null,
});
function dependencies(
  f: Fixture,
  change?: () => Promise<void>,
  badProvider = "",
  badResponse = "",
) {
  const calls = { provider: 0, ticket: 0, request: 0 };
  const value = {
    provider: {
      async get(input: Parameters<BrowserSandboxProvider["get"]>[0]) {
        calls.provider++;
        assert.equal(input.resume, false);
        return {
          name: `ftrade-browser-${f.nodeId}`,
          tags: { "ftrade-node": badProvider === "tag" ? randomUUID() : f.nodeId },
          status: badProvider === "stopped" ? "stopped" : "running",
          persistent: true,
          domain: () =>
            badProvider === "origin"
              ? "https://attacker.example"
              : "https://synthetic-node.vercel.run",
        } as unknown as Awaited<ReturnType<BrowserSandboxProvider["get"]>>;
      },
    },
    async ticket(
      input: { nodeId: string; runId: string },
      actor: { id: string; sessionId: string },
    ) {
      calls.ticket++;
      return ownerBrowserCommand({ operation: "ticket", ...input }, actor);
    },
    async request(input: string | URL | Request, init?: RequestInit) {
      calls.request++;
      assert(init);
      assert.equal(String(input), "https://synthetic-node.vercel.run/publication-inspection");
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("Origin"), "https://synthetic-app.example");
      const body = JSON.parse(String(init.body));
      assert.deepEqual(Object.keys(body), ["ticket"]);
      assert(body.ticket.startsWith(`${f.runId}.`));
      if (change) await change();
      if (badResponse === "oversized") return new Response("x".repeat(8193));
      return Response.json(
        badResponse === "extra"
          ? { ...observation(), privateCaption: "SYNTHETIC private" }
          : badResponse === "stale"
            ? { ...observation(), observedAt: "2000-01-01T00:00:00Z" }
            : observation(),
      );
    },
    appOrigin: () => "https://synthetic-app.example",
  };
  return { value, calls };
}
async function main() {
  let scenarios = 0;
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "./drizzle",
    });
    const f = await fixture(),
      d = dependencies(f);
    const result = await inspectOwnedPublicationPage(
      { nodeId: f.nodeId, runId: f.runId },
      f.actor,
      db,
      d.value,
    );
    assert(result.candidateExpired);
    assert.equal(d.calls.request, 1);
    assert.deepEqual(
      (
        await db.execute(
          sql`SELECT document->'capabilities' AS capabilities FROM browser_fleet_node WHERE id=${f.nodeId}`,
        )
      ).rows[0].capabilities,
      ["interactive"],
    );
    const audits = await db.select().from(auditEvent).where(eq(auditEvent.subjectId, f.nodeId));
    const saved = audits.find((a) => a.action === "browser_publication_page.inspected");
    assert(saved);
    assert.equal(saved.actorId, f.actor.id);
    assert.equal(saved.metadata.candidate_hash, "a".repeat(64));
    assert(!("caption" in saved.metadata));
    scenarios++;
    for (const fault of [
      "banned",
      "role",
      "session",
      "owner",
      "run_owner",
      "run_session",
      "stopped",
      "deadline",
      "lease",
      "extra_input",
    ]) {
      const f = await fixture(),
        d = dependencies(f);
      if (fault === "banned")
        await db.update(user).set({ banned: true }).where(eq(user.id, f.actor.id));
      if (fault === "role")
        await db.update(user).set({ role: "user" }).where(eq(user.id, f.actor.id));
      if (fault === "session")
        await db
          .update(session)
          .set({ expiresAt: new Date(0) })
          .where(eq(session.id, f.actor.sessionId));
      if (fault === "owner")
        await db.execute(
          sql`UPDATE browser_fleet_node SET owner_id=${f.otherOwner} WHERE id=${f.nodeId}`,
        );
      const run = f.state.runs[0];
      if (fault === "run_owner") run.requestedBy = randomUUID();
      if (fault === "run_session") run.authSessionId = randomUUID();
      if (fault === "stopped") run.stopRequested = true;
      if (fault === "deadline") run.deadline = 0;
      if (fault === "lease") run.leaseUntil = 0;
      if (["run_owner", "run_session", "stopped", "deadline", "lease"].includes(fault))
        await save(f);
      await assert.rejects(
        inspectOwnedPublicationPage(
          {
            nodeId: f.nodeId,
            runId: f.runId,
            ...(fault === "extra_input" ? { selector: "private" } : {}),
          },
          f.actor,
          db,
          d.value,
        ),
      );
      assert.equal(d.calls.provider, 0);
      assert.equal(d.calls.request, 0);
      scenarios++;
    }
    for (const fault of ["tag", "origin", "stopped"]) {
      const f = await fixture(),
        d = dependencies(f, undefined, fault);
      await assert.rejects(
        inspectOwnedPublicationPage({ nodeId: f.nodeId, runId: f.runId }, f.actor, db, d.value),
      );
      assert.equal(d.calls.ticket, 0);
      assert.equal(d.calls.request, 0);
      scenarios++;
    }
    for (const fault of ["session", "role", "stopped", "owner"]) {
      const f = await fixture(),
        d = dependencies(f, async () => {
          if (fault === "session")
            await db
              .update(session)
              .set({ expiresAt: new Date(0) })
              .where(eq(session.id, f.actor.sessionId));
          if (fault === "role")
            await db.update(user).set({ role: "user" }).where(eq(user.id, f.actor.id));
          if (fault === "stopped") {
            f.state.runs[0].stopRequested = true;
            await save(f);
          }
          if (fault === "owner")
            await db.execute(
              sql`UPDATE browser_fleet_node SET status='revoked' WHERE id=${f.nodeId}`,
            );
        });
      await assert.rejects(
        inspectOwnedPublicationPage({ nodeId: f.nodeId, runId: f.runId }, f.actor, db, d.value),
      );
      assert.equal(d.calls.request, 1);
      scenarios++;
    }
    for (const fault of ["oversized", "extra", "stale"]) {
      const f = await fixture(),
        d = dependencies(f, undefined, "", fault);
      await assert.rejects(
        inspectOwnedPublicationPage({ nodeId: f.nodeId, runId: f.runId }, f.actor, db, d.value),
      );
      scenarios++;
    }
    const waiting = await fixture(),
      pool = new Pool({ connectionString: connection }),
      blocker = await pool.connect();
    const lockKey = 746253;
    await pool.query(
      "CREATE FUNCTION synthetic_page_inspection_audit_wait() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='browser_publication_page.inspected' THEN PERFORM pg_advisory_xact_lock(746253); END IF; RETURN NEW; END $$",
    );
    await pool.query(
      "CREATE TRIGGER synthetic_page_inspection_audit_wait BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_page_inspection_audit_wait()",
    );
    let pending: Promise<unknown> | undefined;
    try {
      await db
        .update(session)
        .set({ expiresAt: new Date(Date.now() + 1500) })
        .where(eq(session.id, waiting.actor.sessionId));
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
      const {
        rows: [p],
      } = await blocker.query("SELECT pg_backend_pid() AS pid");
      pending = inspectOwnedPublicationPage(
        { nodeId: waiting.nodeId, runId: waiting.runId },
        waiting.actor,
        db,
        dependencies(waiting).value,
      );
      const outcome = pending.then(
          () => null,
          (error: unknown) => error,
        ),
        deadline = performance.now() + 5000;
      for (;;) {
        const {
          rows: [v],
        } = await pool.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
          [p.pid],
        );
        if (v.blocked) break;
        assert(performance.now() < deadline, "Observe actual audit lock wait");
        await delay(10);
      }
      await delay(1600);
      await blocker.query("COMMIT");
      assert((await outcome) instanceof Error);
      assert.equal(
        (
          await db
            .select()
            .from(auditEvent)
            .where(eq(auditEvent.action, "browser_publication_page.inspected"))
        ).filter((a) => a.subjectId === waiting.nodeId).length,
        0,
      );
      scenarios++;
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => {});
      await pool.query("DROP TRIGGER synthetic_page_inspection_audit_wait ON audit_event");
      await pool.query("DROP FUNCTION synthetic_page_inspection_audit_wait()");
      await pool.end();
    }
    console.log(
      `PASS ${scenarios} PostgreSQL page-inspection authorization, origin, late revocation and response-privacy scenarios; no external I/O`,
    );
  } finally {
    await closeDatabase();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
