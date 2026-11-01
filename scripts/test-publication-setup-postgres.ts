import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { claimRun, enqueueRun, initialState } from "../lib/browser-fleet/policy";
import { createAccessKey, digest } from "../lib/browser-fleet/security";
import { handleBrowserNodeRequest } from "../lib/browser-fleet/store";
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

async function main() {
  await migrate(db, { migrationsFolder: "drizzle" });
  const f = await fixture(),
    accessKey = createAccessKey(f.nodeId);
  f.state.installationId = randomUUID();
  f.state.bootId = randomUUID();
  await save(f);
  await db.execute(
    sql`UPDATE browser_fleet_node SET key_hash=${digest(accessKey)} WHERE id=${f.nodeId}`,
  );
  const run = f.state.runs[0];
  const request = {
    operation: "publication-setup",
    audience: "Only me",
    installationId: f.state.installationId,
    bootId: f.state.bootId,
    runId: run.id,
    leaseId: run.leaseId,
    candidateHash: "a".repeat(64),
    expiresAt: Date.now() + 86400000,
  };
  await assert.rejects(handleBrowserNodeRequest(accessKey, { ...request, leaseId: randomUUID() }));
  await assert.rejects(handleBrowserNodeRequest(accessKey, { ...request, bootId: randomUUID() }));
  f.state.accounts[0].enabled = false;
  await save(f);
  await assert.rejects(handleBrowserNodeRequest(accessKey, request));
  f.state.accounts[0].enabled = true;
  f.state.runs.push({ ...run, id: randomUUID(), kind: "publish", status: "queued" });
  await save(f);
  await assert.rejects(handleBrowserNodeRequest(accessKey, request));
  f.state.runs.pop();
  run.stopRequested = true;
  await save(f);
  await assert.rejects(handleBrowserNodeRequest(accessKey, request));
  run.stopRequested = false;
  await save(f);
  await db
    .update(session)
    .set({ expiresAt: new Date(0) })
    .where(eq(session.id, f.actor.sessionId));
  await assert.rejects(handleBrowserNodeRequest(accessKey, request));
  await db
    .update(session)
    .set({ expiresAt: new Date(Date.now() + 3600000) })
    .where(eq(session.id, f.actor.sessionId));
  const response = await handleBrowserNodeRequest(accessKey, request);
  assert.equal(response.active, true);
  const result = await db.execute(
    sql`SELECT document FROM browser_fleet_node WHERE id=${f.nodeId}`,
  );
  const state = result.rows[0].document as typeof f.state;
  assert(state.capabilities.includes("publish"));
  assert.equal(state.publicationScopes?.[0].accountRef, "synthetic-account");
  assert.equal(state.publicationScopes?.[0].textOnly, true);
  const mediaScope = {
    ...state.publicationScopes![0],
    textOnly: false,
    expiresAt: Date.now() + 123456,
  };
  state.publicationScopes = [mediaScope];
  await db.execute(
    sql`UPDATE browser_fleet_node SET document=${JSON.stringify(state)}::jsonb WHERE id=${f.nodeId}`,
  );
  await handleBrowserNodeRequest(accessKey, request);
  const preserved = (
    await db.execute(sql`SELECT document FROM browser_fleet_node WHERE id=${f.nodeId}`)
  ).rows[0].document as typeof f.state;
  assert.deepEqual(preserved.publicationScopes, [mediaScope]);
  assert.deepEqual(preserved.accounts, state.accounts);
  const controls = await db.execute(
    sql`SELECT id FROM social_channel_control WHERE channel_ref='synthetic-facebook' AND account_ref='synthetic-account'`,
  );
  assert.equal(controls.rows.length, 0);
  const audit = await db.select().from(auditEvent).where(eq(auditEvent.subjectId, f.nodeId));
  assert(audit.some((a) => a.action === "browser_publication_setup.activated"));
  console.log(
    "PASS setup rejects stale lease/session, disabled grant and queued publication; exact scope and audit persisted without allowing publishing",
  );
}
main().finally(() => closeDatabase());
