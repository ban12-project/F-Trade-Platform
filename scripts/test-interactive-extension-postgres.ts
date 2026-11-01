import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { claimRun, enqueueRun, initialState } from "../lib/browser-fleet/policy";
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

async function main() {
  await migrate(db, { migrationsFolder: "drizzle" });
  const f = await fixture(),
    run = f.state.runs[0];
  run.deadline = Date.now() + 120000;
  run.leaseUntil = Date.now() + 90000;
  run.connectBefore = Date.now() + 60000;
  await save(f);
  const command = {
    operation: "extend",
    nodeId: f.nodeId,
    runId: run.id,
    expectedDeadline: run.deadline,
  };
  await assert.rejects(ownerBrowserCommand(command, { ...f.actor, sessionId: randomUUID() }));
  await assert.rejects(ownerBrowserCommand(command, { ...f.actor, id: f.otherOwner }));
  const original = structuredClone(run);
  for (const patch of [
    { status: "stopping" },
    { stopRequested: true },
    { leaseUntil: 1 },
    { deadline: 1 },
    { authSessionId: randomUUID() },
  ]) {
    Object.assign(run, patch);
    await save(f);
    await assert.rejects(ownerBrowserCommand(command, f.actor));
    Object.assign(run, original);
  }
  f.state.accounts[0].enabled = false;
  await save(f);
  await assert.rejects(ownerBrowserCommand(command, f.actor));
  f.state.accounts[0].enabled = true;
  await save(f);
  await db.execute(sql`UPDATE browser_fleet_node SET status='revoked' WHERE id=${f.nodeId}`);
  await assert.rejects(ownerBrowserCommand(command, f.actor));
  await db.execute(sql`UPDATE browser_fleet_node SET status='active' WHERE id=${f.nodeId}`);
  const results = await Promise.allSettled([
    ownerBrowserCommand(command, f.actor),
    ownerBrowserCommand(command, f.actor),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const result = await db.execute(
    sql`SELECT document FROM browser_fleet_node WHERE id=${f.nodeId}`,
  );
  const state = result.rows[0].document as typeof f.state;
  assert.equal(state.runs[0].deadline, original.deadline + 1800000);
  assert.deepEqual({ ...state.runs[0], deadline: original.deadline }, original);
  assert.deepEqual(state.accounts, f.state.accounts);
  const audit = await db.select().from(auditEvent).where(eq(auditEvent.subjectId, f.nodeId));
  const extensions = audit.filter((a) => a.action === "browser_interactive.extended");
  assert.equal(extensions.length, 1);
  assert.equal(extensions[0].actorType, "human");
  console.log(
    "PASS real transaction rejects invalid ownership/session, revocation, stale lease/deadline; concurrent extension commits once with audit and unchanged ticket/account/lease",
  );
}
main().finally(() => closeDatabase());
