import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { productMediaAsset } from "../lib/db/product-media-schema";
import * as schema from "../lib/db/schema";
import { VIDEO_DRAFT_ACCESS_MESSAGE } from "../lib/video/draft-write-access";
import { seedVideoCreationFixture } from "../tests/fixtures/video-draft";

const connection = process.env.VIDEO_DRAFT_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
const db = getDatabase(),
  pool = new Pool({ connectionString: connection }),
  bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let sid = "",
  workflowStarts = 0;
let duringRead: (() => Promise<void>) | undefined;
let duringStorage: (() => Promise<void>) | undefined;
const objects = new Map<string, Blob>();
let deleted = 0;
const url = (p: string) => new URL(p, import.meta.url).href;
async function currentSession() {
  const [r] = await db
    .select()
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.id, sid));
  return r ?? null;
}
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", { exports: { revalidatePath: () => {}, refresh: () => {} } });
mock.module(url("../lib/auth.ts"), { exports: { auth: { api: { getSession: currentSession } } } });
mock.module("workflow/api", {
  exports: {
    start: async () => {
      workflowStarts++;
      return { runId: `synthetic-run-${randomUUID()}` };
    },
  },
});
mock.module("@vercel/blob", {
  exports: {
    get: async () => {
      await duringRead?.();
      return {
        statusCode: 200,
        blob: { contentType: "image/png" },
        stream: new Blob([bytes]).stream(),
      };
    },
    head: async () => {
      throw Error("Blob head forbidden");
    },
    del: async () => {
      throw Error("Raw deletion forbidden");
    },
    put: async () => {
      throw Error("Raw upload forbidden");
    },
  },
});
mock.module(url("../lib/evidence/vercel-private-blob.ts"), {
  exports: {
    VercelPrivateBlobEvidenceStore: class {
      async put(input: { pathname: string; contentType: string; body: Blob }) {
        objects.set(input.pathname, input.body);
        await duringStorage?.();
        return { pathname: input.pathname, contentType: input.contentType };
      }
      async delete(path: string) {
        deleted++;
        objects.delete(path);
      }
    },
  },
});
// Provider URLs are resolved by the actual importer; this adapter serves synthetic bytes only.
const providerPage = {
  pageid: 123,
  title: "File:SYNTHETIC.png",
  imageinfo: [
    {
      url: "https://upload.wikimedia.org/synthetic.png",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:SYNTHETIC.png",
      mime: "image/png",
      width: 100,
      height: 100,
      extmetadata: { LicenseShortName: { value: "SYNTHETIC" } },
    },
  ],
};
let duringDownload: (() => Promise<void>) | undefined;
globalThis.fetch = async (input) => {
  const u = new URL(String(input));
  if (u.hostname === "commons.wikimedia.org")
    return Response.json({ query: { pages: [providerPage] } });
  if (u.hostname === "upload.wikimedia.org") {
    await duringDownload?.();
    return new Response(bytes, { headers: { "content-type": "image/png" } });
  }
  throw Error("Outbound forbidden");
};
const actions = await import("../lib/actions/marketing-video");
const { createMarketingVideoEditProjectFromProductMedia } = await import(
  "../lib/video/product-media-create"
);
const { createMarketingVideoEditProject, saveMarketingVideoRenderRequest } = await import(
  "../lib/video/store"
);
const { queueVideoProcessingJob, videoProcessingRequestKey } = await import(
  "../lib/video/processing-jobs"
);
const { issueVideoUploadReceipt, claimCompletedVideoUploads } = await import(
  "../lib/video/upload-receipts"
);
const { importInternetVideoMedia } = await import("../lib/video/internet-media-search");
type Fixture = Awaited<ReturnType<typeof seedVideoCreationFixture>>;
const identity = (f: Fixture) => ({
  actorId: f.actorId,
  sessionId: f.sessionId,
  projectId: f.projectId,
});
const draft = (f: Fixture) => ({ ...f.draft, ctaText: "SYNTHETIC changed CTA" });
const form = (
  f: Fixture,
  mode: "product_media" | "upload" | "internet_search",
  receiptId?: string,
) => {
  const data = new FormData();
  const entries = {
    ...f.fields,
    sourceMode: mode,
    rightsEvidenceRef: mode === "upload" ? f.sourceRef : "",
    productMediaIds: JSON.stringify([f.mediaId]),
    receiptIds: JSON.stringify([receiptId]),
    internetSearchQuery: "SYNTHETIC",
    internetMediaIds: JSON.stringify(["wikimedia:123"]),
  };
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};
async function fixture(role: "admin" | "user" = "user") {
  const f = await seedVideoCreationFixture(db, role);
  sid = f.sessionId;
  return f;
}
async function snapshot(f: Fixture) {
  const [records, audits, links, projects, evidences, receipts] = await Promise.all([
    db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.createdById, f.actorId)),
    db.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorId, f.actorId)),
    db
      .select()
      .from(schema.workspaceProjectItem)
      .where(eq(schema.workspaceProjectItem.projectId, f.projectId)),
    db.select().from(schema.workspaceProject).where(eq(schema.workspaceProject.id, f.projectId)),
    db.select().from(schema.evidence).where(eq(schema.evidence.uploadedById, f.actorId)),
    db
      .select()
      .from(schema.videoUploadReceipt)
      .where(eq(schema.videoUploadReceipt.ownerId, f.actorId)),
  ]);
  const jobs = await db
    .select()
    .from(schema.videoProcessingJob)
    .where(
      inArray(
        schema.videoProcessingJob.videoProjectId,
        records.map((r) => r.id),
      ),
    );
  return { records, audits, links, projects, evidences, receipts, jobs };
}
async function observe(pid: number) {
  for (let i = 0; i < 400; i++) {
    const {
      rows: [r],
    } = await pool.query<{ blocked: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (r.blocked) return;
    await delay(10);
  }
  throw Error("Observe actual PostgreSQL lock wait");
}
const changes = ["revoked", "banned", "expired", "invalid role", "viewer", "removed"] as const;
async function mutate(f: Fixture, change: (typeof changes)[number]) {
  if (change === "revoked")
    await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
  else if (change === "banned")
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
  else if (change === "expired")
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.session.id, f.sessionId));
  else if (change === "invalid role")
    await db.update(schema.user).set({ role: "untrusted" }).where(eq(schema.user.id, f.actorId));
  else if (change === "viewer")
    await db
      .update(schema.workspaceProjectMember)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceProjectMember.projectId, f.projectId),
          eq(schema.workspaceProjectMember.userId, f.actorId),
        ),
      );
  else
    await db
      .delete(schema.workspaceProjectMember)
      .where(
        and(
          eq(schema.workspaceProjectMember.projectId, f.projectId),
          eq(schema.workspaceProjectMember.userId, f.actorId),
        ),
      );
}
const operations = ["create", "generate", "render"] as const;
const run = (f: Fixture, op: (typeof operations)[number]) =>
  op === "create"
    ? actions.createMarketingVideoDraftAction(
        { status: "idle", message: "" },
        form(f, "product_media"),
      )
    : op === "generate"
      ? actions.generateMarketingVideoAiDraftAction(f.projectId, f.videoId)
      : actions.renderMarketingVideoDraftAction(f.projectId, f.videoId, draft(f));
let scenarios = 0;
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  for (const op of operations)
    for (const role of ["admin", "user"] as const) {
      {
        const f = await fixture(role),
          before = await snapshot(f),
          starts = workflowStarts,
          result = await run(f, op);
        assert.equal(result.status, "success", `${op}/${role}`);
        assert(result.videoId);
        const after = await snapshot(f);
        assert.equal(after.jobs.length, 1);
        assert.equal(workflowStarts, starts + 1);
        assert(after.jobs[0].workflowRunId?.startsWith("synthetic-run"));
        assert.equal(
          after.jobs[0].requestKey,
          videoProcessingRequestKey(
            result.videoId,
            op === "render" ? "render" : "ai_draft",
            op === "render" ? 2 : 1,
          ),
        );
        if (op === "create") {
          assert.equal(after.records.length, before.records.length + 1);
          assert(
            after.links.some((l) => l.aggregateId === result.videoId && l.relation === "owned"),
          );
        } else assert.equal(after.records.length, before.records.length);
        scenarios++;
      }
      for (const change of changes) {
        const f = await fixture(role),
          c = await pool.connect();
        let pending: ReturnType<typeof run> | undefined;
        try {
          await c.query("BEGIN");
          await c.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
            op === "create" ? f.productId : f.videoId,
          ]);
          const {
            rows: [r],
          } = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          const starts = workflowStarts;
          pending = run(f, op);
          await observe(r.pid);
          await mutate(f, change);
          const before = await snapshot(f);
          await c.query("COMMIT");
          assert.deepEqual(await pending, { status: "error", message: VIDEO_DRAFT_ACCESS_MESSAGE });
          assert.deepEqual(await snapshot(f), before);
          assert.equal(workflowStarts, starts);
          scenarios++;
        } finally {
          await c.query("ROLLBACK");
          c.release();
          await pending;
        }
      }
      for (const resource of [
        "project",
        "session",
        ...(op === "create" ? ["product", "media"] : ["video"]),
      ]) {
        const f = await fixture(role),
          c = await pool.connect(),
          expires = new Date(Date.now() + 650);
        await db
          .update(schema.session)
          .set({ expiresAt: expires })
          .where(eq(schema.session.id, f.sessionId));
        let pending: ReturnType<typeof run> | undefined;
        try {
          await c.query("BEGIN");
          const table =
              resource === "project"
                ? "workspace_project"
                : resource === "session"
                  ? "session"
                  : resource === "media"
                    ? "product_media_asset"
                    : "aggregate_record",
            id =
              resource === "project"
                ? f.projectId
                : resource === "session"
                  ? f.sessionId
                  : resource === "media"
                    ? f.mediaId
                    : resource === "product"
                      ? f.productId
                      : f.videoId;
          await c.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
          const {
            rows: [r],
          } = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          const before = await snapshot(f),
            starts = workflowStarts;
          pending = run(f, op);
          await observe(r.pid);
          await delay(Math.max(1, expires.getTime() - Date.now() + 30));
          await c.query("COMMIT");
          assert.deepEqual(await pending, { status: "error", message: VIDEO_DRAFT_ACCESS_MESSAGE });
          assert.deepEqual(await snapshot(f), before);
          assert.equal(workflowStarts, starts);
          scenarios++;
        } finally {
          await c.query("ROLLBACK");
          c.release();
          await pending;
        }
      }
    }
  // Media grants are evaluated after both source and identity lock waits.
  for (const resource of ["product", "media", "session"]) {
    const f = await fixture(),
      c = await pool.connect(),
      expires = new Date(Date.now() + 650);
    await db
      .update(productMediaAsset)
      .set({ rightsExpiresAt: expires })
      .where(eq(productMediaAsset.id, f.mediaId));
    let pending: ReturnType<typeof run> | undefined;
    try {
      await c.query("BEGIN");
      await c.query(
        `SELECT id FROM ${resource === "media" ? "product_media_asset" : resource === "session" ? "session" : "aggregate_record"} WHERE id=$1 FOR UPDATE`,
        [resource === "media" ? f.mediaId : resource === "session" ? f.sessionId : f.productId],
      );
      const {
        rows: [r],
      } = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const before = await snapshot(f),
        starts = workflowStarts;
      pending = run(f, "create");
      await observe(r.pid);
      await delay(Math.max(1, expires.getTime() - Date.now() + 30));
      await c.query("COMMIT");
      assert.equal((await pending).status, "error");
      assert.deepEqual(await snapshot(f), before);
      assert.equal(workflowStarts, starts);
      scenarios++;
    } finally {
      await c.query("ROLLBACK");
      c.release();
      await pending;
    }
  }
  // Every human domain boundary rejects actor-only identity; background accepted jobs remain separate.
  for (const op of [
    "create",
    "upload create",
    "generate",
    "render",
    "receipt",
    "claim",
    "internet",
  ]) {
    const f = await fixture(),
      before = await snapshot(f);
    const request = {
      ...f.fields,
      sourceMode: "product_media",
      productMediaIds: [f.mediaId],
      rightsEvidenceRef: "",
    };
    const pending =
      op === "create"
        ? createMarketingVideoEditProjectFromProductMedia(request, f.actorId as never)
        : op === "upload create"
          ? createMarketingVideoEditProject(
              { ...f.fields, rightsEvidenceRef: f.sourceRef },
              f.actorId as never,
              f.video.sourceAssets,
            )
          : op === "generate"
            ? queueVideoProcessingJob(f.videoId, "ai_draft", f.actorId as never)
            : op === "render"
              ? saveMarketingVideoRenderRequest(f.videoId, draft(f), f.actorId as never)
              : op === "receipt"
                ? issueVideoUploadReceipt(
                    {
                      receiptId: randomUUID(),
                      projectId: f.projectId,
                      originalFilename: "synthetic.png",
                      contentType: "image/png",
                      sizeBytes: 8,
                      rightsEvidenceRef: f.sourceRef,
                    },
                    f.actorId as never,
                  )
                : op === "claim"
                  ? claimCompletedVideoUploads([randomUUID()], f.actorId as never, f.sourceRef)
                  : importInternetVideoMedia(
                      {
                        projectId: f.projectId,
                        productId: f.productId,
                        query: "SYNTHETIC",
                        resultIds: ["wikimedia:123"],
                      },
                      f.actorId as never,
                    );
    await assert.rejects(pending);
    assert.deepEqual(await snapshot(f), before);
    scenarios++;
  }
  // Initial upload issuance, whole-batch claiming and private imports recheck after external reads/writes.
  for (const role of ["admin", "user"] as const)
    for (const mode of ["upload", "internet_search"] as const) {
      {
        const f = await fixture(role);
        let receiptId: string | undefined;
        if (mode === "upload") {
          receiptId = randomUUID();
          await issueVideoUploadReceipt(
            {
              receiptId,
              projectId: f.projectId,
              originalFilename: "synthetic.png",
              contentType: "image/png",
              sizeBytes: 8,
              rightsEvidenceRef: f.sourceRef,
            },
            identity(f),
          );
        }
        const result = await actions.createMarketingVideoDraftAction(
          { status: "idle", message: "" },
          form(f, mode, receiptId),
        );
        assert.equal(result.status, "success");
        const after = await snapshot(f);
        assert.equal(after.jobs.length, 1);
        const created = after.records.find((r) => r.id === result.videoId);
        assert(created);
        if (mode === "internet_search")
          assert(
            (created.payload as typeof f.video).sourceAssets.every(
              (a) => a.usagePolicy === "private_test_only",
            ),
          );
        scenarios++;
      }
      for (const change of changes) {
        const f = await fixture(role);
        let receiptId: string | undefined;
        if (mode === "upload") {
          receiptId = randomUUID();
          await issueVideoUploadReceipt(
            {
              receiptId,
              projectId: f.projectId,
              originalFilename: "synthetic.png",
              contentType: "image/png",
              sizeBytes: 8,
              rightsEvidenceRef: f.sourceRef,
            },
            identity(f),
          );
        }
        const before = await snapshot(f),
          starts = workflowStarts;
        const callback = () => mutate(f, change);
        if (mode === "upload") duringRead = callback;
        else duringDownload = callback;
        const result = await actions.createMarketingVideoDraftAction(
          { status: "idle", message: "" },
          form(f, mode, receiptId),
        );
        duringRead = undefined;
        duringDownload = undefined;
        assert.deepEqual(result, { status: "error", message: VIDEO_DRAFT_ACCESS_MESSAGE });
        assert.deepEqual(await snapshot(f), before);
        assert.equal(workflowStarts, starts);
        scenarios++;
      }
    }
  {
    const f = await fixture(),
      before = await snapshot(f),
      oldObjects = objects.size,
      oldDeleted = deleted;
    duringStorage = async () => {
      duringStorage = undefined;
      await mutate(f, "revoked");
    };
    await assert.rejects(
      importInternetVideoMedia(
        {
          projectId: f.projectId,
          productId: f.productId,
          query: "SYNTHETIC",
          resultIds: ["wikimedia:123"],
        },
        identity(f),
      ),
    );
    assert.deepEqual(await snapshot(f), before);
    assert.equal(objects.size, oldObjects);
    assert.equal(deleted, oldDeleted + 1);
    scenarios++;
  }
  // A failed second receipt cannot partially claim the first.
  {
    const f = await fixture(),
      ids = [randomUUID(), randomUUID()];
    for (const receiptId of ids)
      await issueVideoUploadReceipt(
        {
          receiptId,
          projectId: f.projectId,
          originalFilename: "synthetic.png",
          contentType: "image/png",
          sizeBytes: 8,
          rightsEvidenceRef: f.sourceRef,
        },
        identity(f),
      );
    const before = await snapshot(f);
    let reads = 0;
    duringRead = async () => {
      if (++reads === 2)
        await db
          .update(schema.videoUploadReceipt)
          .set({ status: "failed" })
          .where(eq(schema.videoUploadReceipt.id, ids[1]));
    };
    await assert.rejects(claimCompletedVideoUploads(ids, identity(f), f.sourceRef));
    duringRead = undefined;
    const after = await snapshot(f);
    assert.deepEqual(after.evidences, before.evidences);
    assert.equal(after.receipts.find((r) => r.id === ids[0])?.status, "issued");
    assert.equal(after.receipts.find((r) => r.id === ids[1])?.status, "failed");
    scenarios++;
  }
  // Signing/reissuing also rechecks after actual project, receipt and identity waits.
  for (const role of ["admin", "user"] as const)
    for (const resource of ["project", "receipt", "session"] as const) {
      const f = await fixture(role),
        receiptId = randomUUID();
      const payload = {
        receiptId,
        projectId: f.projectId,
        originalFilename: "synthetic.png",
        contentType: "image/png" as const,
        sizeBytes: 8,
        rightsEvidenceRef: f.sourceRef,
      };
      if (resource === "receipt") await issueVideoUploadReceipt(payload, identity(f));
      const c = await pool.connect();
      let pending: ReturnType<typeof issueVideoUploadReceipt> | undefined;
      try {
        await c.query("BEGIN");
        await c.query(
          `SELECT id FROM ${resource === "project" ? "workspace_project" : resource === "receipt" ? "video_upload_receipt" : "session"} WHERE id=$1 FOR UPDATE`,
          [resource === "project" ? f.projectId : resource === "receipt" ? receiptId : f.sessionId],
        );
        const {
          rows: [r],
        } = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending = issueVideoUploadReceipt(payload, identity(f));
        const rejected = assert.rejects(pending);
        await observe(r.pid);
        if (resource === "session") await c.query("DELETE FROM session WHERE id=$1", [f.sessionId]);
        else await mutate(f, "revoked");
        const before = await snapshot(f);
        await c.query("COMMIT");
        await rejected;
        assert.deepEqual(await snapshot(f), before);
        scenarios++;
      } finally {
        await c.query("ROLLBACK");
        c.release();
        await pending?.catch(() => undefined);
      }
    }
  // Guarded evidence uploads retain uncertain storage/commit outcomes.
  const { persistUploadedEvidence } = await import("../lib/evidence/persist-upload");
  const { authorizeLockedVideoDraft } = await import("../lib/video/draft-write-access");
  for (const outcome of ["lost put", "lost commit"] as const) {
    const f = await fixture(),
      oldSize = objects.size,
      oldDeleted = deleted;
    let transactions = 0;
    const database =
      outcome === "lost commit"
        ? new Proxy(db, {
            get(target, key, receiver) {
              if (key === "transaction")
                return async (...args: Parameters<typeof db.transaction>) => {
                  const result = await target.transaction(...args);
                  if (++transactions === 2) throw Error("SYNTHETIC lost commit acknowledgement");
                  return result;
                };
              return Reflect.get(target, key, receiver);
            },
          })
        : db;
    if (outcome === "lost put")
      duringStorage = async () => {
        duringStorage = undefined;
        throw Error("SYNTHETIC lost put acknowledgement");
      };
    const sha256 = randomUUID();
    await assert.rejects(
      persistUploadedEvidence(
        {
          actorId: f.actorId,
          filename: "synthetic.png",
          contentType: "image/png",
          sizeBytes: 8,
          sha256,
          sourceLabel: "SYNTHETIC guarded upload",
          body: new Blob([bytes]),
          authorize: async (tx) => {
            await authorizeLockedVideoDraft(tx, identity(f));
          },
        },
        database,
      ),
    );
    assert.equal(objects.size, oldSize + 1);
    assert.equal(deleted, oldDeleted);
    const evidenceRows = await db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.sha256, sha256));
    assert.equal(evidenceRows.length, outcome === "lost commit" ? 1 : 0);
    scenarios++;
  }
  console.log(
    `PASS ${scenarios} actual video intake/generate/render Actions and domain cases: current writers, lock expiry, media expiry, atomic edit/queue and upload batches, private import cleanup; external execution adapters synthetic only`,
  );
} finally {
  mock.restoreAll();
  await pool.end();
  await closeDatabase();
}
