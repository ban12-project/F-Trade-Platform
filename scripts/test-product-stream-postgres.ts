import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Database, DatabaseTransaction } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";
import {
  authorizeProductStreamWrite,
  finishProductStreamRun,
  persistProductStreamDraft,
  startProductStreamRun,
} from "../lib/product/stream-store";
import {
  emptyProductStreamDraft,
  validateProductStreamProposal,
} from "../lib/product/stream-validation";
import { decideProductCatalogReview } from "../lib/products";

import { testMockProductPersistence } from "./test-mock-product-persistence";

async function verify() {
  const connectionString = process.env.PRODUCT_STREAM_TEST_DATABASE_URL;
  assert.ok(connectionString, "Dedicated test database URL is required");
  const address = new URL(connectionString);
  assert.ok(["127.0.0.1", "localhost"].includes(address.hostname));
  assert.equal(address.pathname, "/f_trade_stream_test");
  const pool = new Pool({ connectionString, max: 5 });
  const revoker = new Pool({
    connectionString,
    application_name: "stream-revocation-test",
    max: 1,
  });
  const db = drizzle(pool, { schema });
  // Both drivers use PostgreSQL transactions; this adapter substitutes only the wire transport.
  const database = db as unknown as Database;
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const retiredLayout = await pool.query(
      "SELECT to_regclass('public.video_canvas_document') AS table_name",
    );
    assert.equal(
      retiredLayout.rows[0]?.table_name,
      null,
      "Retired personal layout table must be absent after migrations",
    );
    const identity = {
      actorId: "synthetic-admin",
      sessionId: "synthetic-session",
      projectId: "00000000-0000-4000-8000-000000000117",
    };
    await db.insert(schema.user).values({
      id: identity.actorId,
      name: "Synthetic admin",
      email: "synthetic@example.invalid",
      role: "admin",
    });
    await db.insert(schema.session).values({
      id: identity.sessionId,
      token: "synthetic-test-token",
      userId: identity.actorId,
      expiresAt: new Date(Date.now() + 60000),
    });
    await db.insert(schema.workspaceProject).values({
      id: identity.projectId,
      title: "Synthetic stream test",
      kind: "marketing",
      createdById: identity.actorId,
    });
    await db.insert(schema.workspaceProjectMember).values({
      id: "synthetic-member",
      projectId: identity.projectId,
      userId: identity.actorId,
      role: "owner",
      createdById: identity.actorId,
    });
    await db.insert(schema.evidence).values({
      id: "evidence-synthetic",
      classification: "internal",
      blobKey: "synthetic/not-a-real-blob",
      contentType: "text/plain",
      sha256: "a".repeat(64),
      sizeBytes: 32,
      sourceLabel: "Synthetic fixture",
      uploadedByType: "human",
      uploadedById: identity.actorId,
    });
    const source = {
      record_id: "00000000-0000-4000-8000-000000000118",
      source_ref: "source-synthetic",
      evidence_refs: ["evidence-synthetic"],
      source_text: "Product name: Synthetic clutch\nProduct type: clutch_disc",
      image_availability: "none" as const,
      image_refs: [],
    };
    const run = await startProductStreamRun(
      identity,
      source,
      { provider: "synthetic", model: "synthetic-model" },
      database,
    );
    const located = prepareProductAgentEvidenceSource(source);
    const checked = validateProductStreamProposal(
      emptyProductStreamDraft(located),
      {
        field: "product.product_name",
        value: "Synthetic clutch",
        evidenceRef: located.evidence_locations[0]?.ref,
      },
      located,
    );
    assert.equal(checked.status, "source_validated");
    if (checked.status !== "source_validated") throw new Error("Fixture validation failed");
    assert.deepEqual(
      await persistProductStreamDraft(identity, run.runId, checked.draft, database),
      { productId: run.productId, version: 2 },
    );
    const [approval] = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.aggregateId, run.productId));
    assert.ok(approval);
    const decision = {
      productId: run.productId,
      reviewedVersion: "2",
      approvalId: approval.id,
      decision: "rejected" as const,
      evidenceRef: "evidence-synthetic",
      notes: "Synthetic test rejection",
    };
    await assert.rejects(
      () => decideProductCatalogReview(decision, identity.actorId, database),
      /资料仍在生成中/,
    );

    let revoke: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await authorizeProductStreamWrite(tx as unknown as DatabaseTransaction, identity);
      revoke = revoker.query('UPDATE "user" SET role = $1 WHERE id = $2', [
        "user",
        identity.actorId,
      ]);
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const result = await pool.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE application_name = 'stream-revocation-test'",
        );
        if (result.rows.some((row) => row.wait_event_type === "Lock")) {
          blocked = true;
          break;
        }
        await delay(20);
      }
      assert.equal(blocked, true, "Role revocation must wait for the authorized transaction lock");
    });
    await revoke;
    await assert.rejects(
      () => persistProductStreamDraft(identity, run.runId, checked.draft, database),
      /管理员会话/,
    );
    await finishProductStreamRun(identity, run.runId, "interrupted", database);
    const [preserved] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, run.productId));
    assert.equal(preserved?.version, 2);
    assert.equal(preserved?.state, "PRODUCT_REVIEW_REQUIRED");
    assert.deepEqual(preserved?.payload.product, { product_name: "Synthetic clutch" });
    await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, identity.actorId));
    assert.equal(
      (await decideProductCatalogReview(decision, identity.actorId, database)).state,
      "PRODUCT_REVISION_REQUIRED",
    );
    await assert.rejects(
      () => persistProductStreamDraft(identity, run.runId, checked.draft, database),
      /生成任务已结束/,
    );
    const audits = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.aggregateId, run.productId));
    assert.ok(audits.some((row) => row.action === "product_agent_stream_fields_saved"));
    assert.ok(
      audits.some(
        (row) =>
          row.action === "product_agent_stream_finished" && row.metadata.status === "interrupted",
      ),
    );
    console.log(
      "PASS PostgreSQL migrations, incremental persistence, review guard, actual authorization locks and retained interruption audit",
    );
    await testMockProductPersistence(database, identity.actorId, identity.projectId);
  } finally {
    await revoker.end();
    await pool.end();
  }
}
void verify();
