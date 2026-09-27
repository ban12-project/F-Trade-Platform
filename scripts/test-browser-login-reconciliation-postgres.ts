import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FleetState, Run } from "../lib/browser-fleet/policy";
import { ownerBrowserCommand } from "../lib/browser-fleet/store";
import type { Database } from "../lib/db/client";

export async function testReconciledLogin(
  db: Database,
  input: {
    owner: { id: string; sessionId: string };
    nodeId: string;
    accountId: string;
    jobId: string;
    publicationId: string;
  },
) {
  const { owner, nodeId, accountId, jobId, publicationId } = input;
  const command = { operation: "confirm-login", nodeId, accountId, confirmed: true };
  const read = async () => {
    const node = (await db.execute(sql`SELECT document FROM browser_fleet_node WHERE id=${nodeId}`))
      .rows[0].document as FleetState;
    const receipt = (
      await db.execute(
        sql`SELECT receipt, received_at, payload FROM browser_fleet_publication WHERE job_id=${jobId}`,
      )
    ).rows[0];
    const channel = (
      await db.execute(sql`SELECT c.* FROM social_channel_control c JOIN social_publication p
        ON p.channel_ref=c.channel_ref AND p.account_ref=c.account_ref WHERE p.id=${publicationId}`)
    ).rows[0];
    return { node, receipt, channel };
  };
  const before = await read();
  const run = before.node.runs.find((r) => r.jobRef === jobId);
  assert.ok(run);
  assert.equal(run.status, "unknown");
  const audit = (
    await db.execute(sql`SELECT id, actor_id, metadata FROM audit_event WHERE subject_id=${publicationId}
      AND action='social_publication.reconciled'`)
  ).rows[0];
  assert.ok(audit);
  const reject = () =>
    assert.rejects(ownerBrowserCommand(command, owner), /resolve_running_or_unknown_result_first/);
  await assert.rejects(
    ownerBrowserCommand(command, { ...owner, sessionId: randomUUID() }),
    /owner_session_expired/,
  );
  // Historical attestations are append-only; recovery must still reject a
  // mismatched business record or account/reservation chain.
  await assert.rejects(
    db.execute(sql`UPDATE audit_event SET actor_id=${randomUUID()} WHERE id=${audit.id}`),
    (error: unknown) =>
      error instanceof Error &&
      error.cause instanceof Error &&
      /append-only/.test(error.cause.message),
  );
  try {
    await db.execute(sql`UPDATE social_publication SET status='unknown' WHERE id=${publicationId}`);
    await reject();
  } finally {
    await db.execute(
      sql`UPDATE social_publication SET status='published' WHERE id=${publicationId}`,
    );
  }
  for (const mismatch of ["account", "reservation"] as const) {
    const state = structuredClone(before.node);
    if (mismatch === "account") {
      const account = state.accounts.find((a) => a.id === accountId);
      assert.ok(account);
      account.accountRef = randomUUID();
    } else {
      const targetRun: Run | undefined = state.runs.find((r) => r.id === run.id);
      assert.ok(targetRun);
      targetRun.id = randomUUID();
    }
    try {
      await db.execute(
        sql`UPDATE browser_fleet_node SET document=${JSON.stringify(state)}::jsonb WHERE id=${nodeId}`,
      );
      await reject();
    } finally {
      await db.execute(
        sql`UPDATE browser_fleet_node SET document=${JSON.stringify(before.node)}::jsonb WHERE id=${nodeId}`,
      );
    }
  }
  try {
    await db.execute(
      sql`UPDATE browser_fleet_publication SET payload=payload || '{"tampered":true}'::jsonb WHERE job_id=${jobId}`,
    );
    await reject();
  } finally {
    await db.execute(
      sql`UPDATE browser_fleet_publication SET payload=${JSON.stringify(before.receipt.payload)}::jsonb WHERE job_id=${jobId}`,
    );
  }
  for (const status of ["running", "unknown"] as const) {
    const state = structuredClone(before.node);
    state.runs.push({
      ...run,
      id: randomUUID(),
      jobRef: randomUUID(),
      status,
      leaseUntil: Date.now() + 60000,
      deadline: Date.now() + 60000,
    });
    try {
      await db.execute(
        sql`UPDATE browser_fleet_node SET document=${JSON.stringify(state)}::jsonb WHERE id=${nodeId}`,
      );
      await reject();
    } finally {
      await db.execute(
        sql`UPDATE browser_fleet_node SET document=${JSON.stringify(before.node)}::jsonb WHERE id=${nodeId}`,
      );
    }
  }
  await Promise.all(Array.from({ length: 3 }, () => ownerBrowserCommand(command, owner)));
  const after = await read();
  assert.equal(after.node.accounts.find((a) => a.id === accountId)?.authState, "ready");
  assert.deepEqual(after.node.runs, before.node.runs, "never rewrite or enqueue a publication");
  assert.deepEqual(after.receipt, before.receipt, "original unknown receipt remains immutable");
  assert.deepEqual(
    after.channel,
    before.channel,
    "explicit login confirmation never resumes posting",
  );
  assert.equal(after.channel.circuit_status, "paused");
  console.log(
    "PASS reconciled login: scoped human evidence, payload integrity, live/unresolved refusal, session rejection, concurrent confirmation and immutable pause/receipt/runs",
  );
}
