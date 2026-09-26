import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../lib/db/client";
import { reconcileUnknownTextPublication } from "../lib/social/publication-reconciliation";
import { publicationReconciliationSchema } from "../lib/social/publication-reconciliation-schema";
import { listProjectPublicationData } from "../lib/social/publication-store";

export async function testPublicationReconciliation(
  db: Database,
  input: {
    actor: string;
    projectId: string;
    publicationId: string;
    jobId: string;
    contentRef: string;
  },
) {
  const { actor, projectId, publicationId, jobId, contentRef } = input;
  const value = {
    projectId,
    publicationId,
    externalPublicationRef: `https://www.facebook.com/synthetic/posts/${randomUUID()}`,
    evidenceRef: "evidence-synthetic-observation",
    confirmed: true,
  };
  assert.equal(
    publicationReconciliationSchema.safeParse({ ...value, externalPublicationRef: "invalid" })
      .success,
    false,
  );
  assert.equal(
    publicationReconciliationSchema.safeParse({
      ...value,
      externalPublicationRef: "https://evil.invalid/posts/1",
    }).success,
    false,
  );
  assert.equal(
    publicationReconciliationSchema.safeParse({ ...value, confirmed: false }).success,
    false,
  );
  const original = (
    await db.execute(
      sql`SELECT receipt, received_at FROM browser_fleet_publication WHERE job_id = ${jobId}`,
    )
  ).rows[0];
  await assert.rejects(reconcileUnknownTextPublication(value, randomUUID(), db));
  await assert.rejects(
    reconcileUnknownTextPublication({ ...value, projectId: randomUUID() }, actor, db),
  );
  await db.execute(sql`UPDATE aggregate_record SET version = version + 1 WHERE id = ${contentRef}`);
  await assert.rejects(reconcileUnknownTextPublication(value, actor, db), /内容或原确认已变化/);
  await db.execute(sql`UPDATE aggregate_record SET version = version - 1 WHERE id = ${contentRef}`);
  await db.execute(sql`UPDATE workspace_project SET status = 'archived' WHERE id = ${projectId}`);
  const results = await Promise.all(
    Array.from({ length: 3 }, () => reconcileUnknownTextPublication(value, actor, db)),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(results.filter((r) => r.replayed).length, 2);
  await assert.rejects(
    reconcileUnknownTextPublication({ ...value, evidenceRef: "evidence-conflict" }, actor, db),
    /不能覆盖/,
  );
  const current = (
    await db.execute(
      sql`SELECT receipt, received_at FROM browser_fleet_publication WHERE job_id = ${jobId}`,
    )
  ).rows[0];
  assert.deepEqual(current, original, "original unknown node receipt is immutable");
  const records = (
    await db.execute(sql`SELECT s.status, s.published_at, j.status as job_status, a.version,
    c.circuit_status FROM social_publication s JOIN social_browser_job j ON j.id = s.browser_job_id
    JOIN aggregate_record a ON a.id = s.content_ref JOIN social_channel_control c ON c.channel_ref = s.channel_ref AND c.account_ref = s.account_ref
    WHERE s.id = ${publicationId}`)
  ).rows[0];
  assert.equal(records.status, "published");
  assert.equal(records.job_status, "succeeded");
  assert.equal(
    records.published_at,
    null,
    "confirmation time is not an invented platform publication time",
  );
  assert.equal(records.version, 2);
  assert.equal(records.circuit_status, "paused");
  assert.equal(
    (
      await db.execute(
        sql`SELECT id FROM audit_event WHERE subject_id = ${publicationId} AND action = 'social_publication.reconciled'`,
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (await listProjectPublicationData(projectId, db)).publications.find(
      (p) => p.id === publicationId,
    )?.humanConfirmed,
    true,
  );
  await db.execute(sql`UPDATE workspace_project SET status = 'active' WHERE id = ${projectId}`);
  console.log(
    "PASS manual receipt reconciliation: current owner/project/content, concurrent replay, immutable original receipt, one version increment and preserved channel pause",
  );
}
