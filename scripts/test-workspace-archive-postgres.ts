import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { decideContentReview } from "../lib/content/store";
import { closeDatabase, getDatabase } from "../lib/db/client";
import {
  aggregateRecord,
  user,
  videoProcessingJob,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "../lib/db/schema";
import { rfqFormSchema } from "../lib/form-schemas";
import { decideProductCatalogReview } from "../lib/products";
import { createRfq, listProjectRfqEntries, reviseRfq } from "../lib/sales/store";
import {
  completeVideoJob,
  markVideoJobRunning,
  queueVideoProcessingJob,
} from "../lib/video/processing-jobs";
import { beginMarketingVideoRender } from "../lib/video/store";
import { assertWorkspaceProjectAccess } from "../lib/workspace/access";
import { changeWorkspaceProjectStatus } from "../lib/workspace/store";

const connection = process.env.WORKSPACE_ARCHIVE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";

void (async () => {
  const db = getDatabase();
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const actorId = randomUUID(),
      projectId = randomUUID();
    await db.insert(user).values({
      id: actorId,
      name: "SYNTHETIC archive",
      email: `${actorId}@example.invalid`,
      role: "admin",
    });
    await db.insert(workspaceProject).values({
      id: projectId,
      kind: "sales",
      title: "SYNTHETIC archive",
      status: "archived",
      createdById: actorId,
    });
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId,
      userId: actorId,
      role: "owner",
      createdById: actorId,
    });
    const input = rfqFormSchema.parse({
      customerName: "SYNTHETIC",
      customerCompany: "",
      customerCountry: "",
      productType: "clutch_disc",
      oeNumber: "",
      vehicleBrand: "",
      vehicleModel: "",
      quantity: "",
      destination: "",
      evidenceRef: "evidence-synthetic-archive",
    });
    const before = await db
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.createdById, actorId));
    await assert.rejects(createRfq(input, actorId, projectId), /已归档/);
    assert.deepEqual(
      await db.select().from(aggregateRecord).where(eq(aggregateRecord.createdById, actorId)),
      before,
    );
    console.log("PASS archived direct RFQ creation rejects without business writes");
    const outsider = randomUUID();
    await db
      .insert(user)
      .values({ id: outsider, name: "SYNTHETIC outsider", email: `${outsider}@example.invalid` });
    await assert.rejects(
      changeWorkspaceProjectStatus({ projectId, status: "active" }, outsider, db),
      /所有者/,
    );
    await assertWorkspaceProjectAccess(projectId, actorId, "view", db);
    await assertWorkspaceProjectAccess(projectId, actorId, "receipt", db);
    await assert.rejects(
      assertWorkspaceProjectAccess(projectId, outsider, "receipt", db),
      /编辑权限/,
    );
    await changeWorkspaceProjectStatus({ projectId, status: "active" }, actorId, db);
    const rfq = await createRfq(input, actorId, projectId);
    await changeWorkspaceProjectStatus({ projectId, status: "archived" }, actorId, db);
    const [saved] = await db.select().from(aggregateRecord).where(eq(aggregateRecord.id, rfq.id));
    await assert.rejects(
      reviseRfq(rfq.id, { ...input, customerName: "SYNTHETIC changed" }, actorId),
      /已归档/,
    );
    assert.deepEqual(
      (await db.select().from(aggregateRecord).where(eq(aggregateRecord.id, rfq.id)))[0],
      saved,
    );
    assert.equal((await listProjectRfqEntries(projectId)).length, 1);
    await changeWorkspaceProjectStatus({ projectId, status: "active" }, actorId, db);
    await reviseRfq(rfq.id, { ...input, customerName: "SYNTHETIC reopened" }, actorId);
    console.log(
      "PASS reopening, owner enforcement, archived reads, stale RFQ save and receipt membership",
    );

    const marketing = randomUUID();
    await db.insert(workspaceProject).values({
      id: marketing,
      kind: "marketing",
      title: "SYNTHETIC archive domains",
      createdById: actorId,
    });
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId: marketing,
      userId: actorId,
      role: "owner",
      createdById: actorId,
    });
    const ids = { product: randomUUID(), content: randomUUID(), video: randomUUID() };
    for (const type of ["product", "content", "video"] as const) {
      await db.insert(aggregateRecord).values({
        id: ids[type],
        type,
        state: type === "video" ? "VIDEO_DRAFT" : `${type.toUpperCase()}_REVIEW_REQUIRED`,
        payload: { synthetic: true },
        createdByType: "human",
        createdById: actorId,
      });
      await db.insert(workspaceProjectItem).values({
        id: randomUUID(),
        projectId: marketing,
        aggregateId: ids[type],
        role:
          type === "product"
            ? "product_source"
            : type === "content"
              ? "marketing_content"
              : "marketing_video",
        relation: "owned",
      });
    }
    const running = await queueVideoProcessingJob(ids.video, "render", actorId, db);
    await markVideoJobRunning(running.job.id, db);
    const queued = await queueVideoProcessingJob(ids.video, "ai_draft", actorId, db);
    await changeWorkspaceProjectStatus({ projectId: marketing, status: "archived" }, actorId, db);
    const review = {
      reviewedVersion: "1",
      approvalId: randomUUID(),
      decision: "approved" as const,
      evidenceRef: "evidence-synthetic-archive",
      notes: "",
    };
    await assert.rejects(
      decideProductCatalogReview({ ...review, productId: ids.product }, actorId, db),
      /已归档/,
    );
    await assert.rejects(
      decideContentReview({ ...review, contentId: ids.content }, actorId, db),
      /已归档/,
    );
    await assert.rejects(beginMarketingVideoRender(ids.video, actorId, db), /已归档/);
    await assert.rejects(queueVideoProcessingJob(ids.video, "render", actorId, db), /已归档/);
    await assert.rejects(markVideoJobRunning(queued.job.id, db), /已归档/);
    assert.equal(
      (
        await db.select().from(videoProcessingJob).where(eq(videoProcessingJob.id, queued.job.id))
      )[0].status,
      "queued",
    );
    await completeVideoJob(running.job.id, db);
    assert.equal(
      (
        await db.select().from(videoProcessingJob).where(eq(videoProcessingJob.id, running.job.id))
      )[0].status,
      "succeeded",
    );
    await changeWorkspaceProjectStatus({ projectId: marketing, status: "active" }, actorId, db);
    assert.equal((await markVideoJobRunning(queued.job.id, db)).status, "running");
    console.log(
      "PASS archived product/content/video writes, queued task freeze, in-flight completion, reopened task claim",
    );

    let unlock!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const archiving = db.transaction(async (tx) => {
      await tx
        .update(workspaceProject)
        .set({ status: "archived" })
        .where(eq(workspaceProject.id, projectId));
      locked();
      await release;
    });
    await acquired;
    const racingWrite = assert.rejects(createRfq(input, actorId, projectId), /已归档/);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await db.execute(
          sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%workspace_project%'`,
        );
        if (result.rows.length) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(waiting, "business write must actually wait for the archive transaction");
    } finally {
      unlock();
    }
    await archiving;
    await racingWrite;
    assert.equal((await listProjectRfqEntries(projectId)).length, 1);
    console.log(
      "PASS concurrent archive/write row-lock serialization; no losing transaction business write",
    );
  } finally {
    await closeDatabase();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
