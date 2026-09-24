import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../lib/db/client";
import { reconcileUnknownVideoPublication } from "../lib/social/publication-reconciliation";
import { videoPublicationReconciliationSchema } from "../lib/social/publication-reconciliation-schema";

export async function testVideoPublicationReconciliation(
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
    externalPublicationRef: "https://www.facebook.com/reel/1234567890123456/",
    evidenceRef: "evidence-synthetic-video-observation",
    confirmed: true,
  };
  for (const invalid of [
    { ...value, externalPublicationRef: `${value.externalPublicationRef}?tracking=1` },
    { ...value, externalPublicationRef: "https://evil.invalid/reel/1/" },
    { ...value, confirmed: false },
  ])
    assert.equal(videoPublicationReconciliationSchema.safeParse(invalid).success, false);
  const original = (
    await db.execute(
      sql`SELECT receipt, received_at FROM browser_fleet_publication WHERE job_id = ${jobId}`,
    )
  ).rows[0];
  await assert.rejects(reconcileUnknownVideoPublication(value, randomUUID(), db));
  await assert.rejects(
    reconcileUnknownVideoPublication({ ...value, projectId: randomUUID() }, actor, db),
  );
  await db.execute(sql`UPDATE aggregate_record SET version = version + 1 WHERE id = ${contentRef}`);
  await assert.rejects(reconcileUnknownVideoPublication(value, actor, db));
  await db.execute(sql`UPDATE aggregate_record SET version = version - 1 WHERE id = ${contentRef}`);
  const results = await Promise.all(
    Array.from({ length: 3 }, () => reconcileUnknownVideoPublication(value, actor, db)),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(results.filter((r) => r.replayed).length, 2);
  await assert.rejects(
    reconcileUnknownVideoPublication({ ...value, evidenceRef: "evidence-conflict" }, actor, db),
    /不能覆盖/,
  );
  const current = (
    await db.execute(
      sql`SELECT receipt, received_at FROM browser_fleet_publication WHERE job_id = ${jobId}`,
    )
  ).rows[0];
  assert.deepEqual(current, original);
  const record = (
    await db.execute(sql`SELECT s.status, s.published_at, j.status AS job_status, a.version,
    c.circuit_status FROM social_publication s JOIN social_browser_job j ON j.id=s.browser_job_id
    JOIN aggregate_record a ON a.id=s.content_ref JOIN social_channel_control c ON c.channel_ref=s.channel_ref AND c.account_ref=s.account_ref
    WHERE s.id=${publicationId}`)
  ).rows[0];
  assert.equal(record.status, "published");
  assert.equal(record.job_status, "succeeded");
  assert.equal(record.published_at, null);
  assert.equal(
    record.version,
    1,
    "video approval version is not changed by publication reconciliation",
  );
  assert.equal(record.circuit_status, "paused");
  assert.equal(
    (
      await db.execute(
        sql`SELECT id FROM audit_event WHERE subject_id=${publicationId} AND action='social_publication.reconciled'`,
      )
    ).rows.length,
    1,
  );
  console.log(
    "PASS video human reconciliation: scoped Reel, current manifest, concurrent replay, immutable unknown receipt, unchanged approval and channel pause",
  );
}
