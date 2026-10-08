import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { productMediaAsset } from "../lib/db/product-media-schema";
import * as schema from "../lib/db/schema";
import { productMediaFailureMessage } from "../lib/product/media-write-access";
import { seedVideoCreationFixture } from "../tests/fixtures/video-draft";

const connection = process.env.VIDEO_DRAFT_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw Error("Outbound forbidden");
};
const db = getDatabase(),
  pool = new Pool({ connectionString: connection });
let sid = "";
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", { exports: { revalidatePath: () => {} } });
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: {
    auth: {
      api: {
        getSession: async () => {
          const [r] = await db
            .select()
            .from(schema.session)
            .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
            .where(eq(schema.session.id, sid));
          return r ?? null;
        },
      },
    },
  },
});
let duringProbe: (() => Promise<void>) | undefined;
mock.module(new URL("../lib/video/sandbox-sources.ts", import.meta.url).href, {
  exports: { issueSandboxVideoSources: async () => new Map() },
});
mock.module(new URL("../lib/product/media-sandbox-probe.ts", import.meta.url).href, {
  exports: {
    probeProductMediaEvidenceInSandbox: async () => {
      await duringProbe?.();
      return {
        mediaType: "image",
        technical: {
          contentType: "image/png",
          width: 100,
          height: 100,
          durationMs: null,
          fps: null,
          hasAudio: false,
        },
      };
    },
  },
});
mock.module("@vercel/blob", {
  exports: {
    get: async () => ({
      statusCode: 200,
      blob: { contentType: "image/png" },
      stream: new Blob([
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ]).stream(),
    }),
    put: async () => {
      throw Error("Cloud writes forbidden");
    },
    del: async () => {
      throw Error("Cloud deletion forbidden");
    },
    head: async () => {
      throw Error("Cloud head forbidden");
    },
  },
});
const { reviewProductMediaAction, registerProductMediaAction } = await import(
  "../lib/actions/product-media"
);
const { registerProductMediaAsset, reviewProductMediaAsset } = await import(
  "../lib/product/media-store"
);
type F = Awaited<ReturnType<typeof seedVideoCreationFixture>>;
const identity = (f: F) => ({ actorId: f.actorId, sessionId: f.sessionId, projectId: f.projectId });
async function fixture(role: "admin" | "user" = "admin") {
  const f = await seedVideoCreationFixture(db, role);
  sid = f.sessionId;
  await db
    .update(productMediaAsset)
    .set({ reviewStatus: "pending", reviewedBy: null, reviewedAt: null, reviewEvidenceRef: null })
    .where(eq(productMediaAsset.id, f.mediaId));
  return f;
}
const form = (f: F, decision = "approved", evidence = f.decisionRef) => {
  const d = new FormData();
  for (const [k, v] of Object.entries({
    projectId: f.projectId,
    productId: f.productId,
    assetId: f.mediaId,
    decision,
    evidenceRef: evidence,
    notes: "SYNTHETIC review",
  }))
    d.set(k, v);
  return d;
};
const input = (f: F, evidenceRef = f.sourceRef) => ({
  productId: f.productId,
  evidenceRef,
  origin: "factory" as const,
  semantic: {
    role: "product_hero" as const,
    description: "SYNTHETIC registration",
    tags: [],
    productVisible: true,
    logoVisible: false,
    textPresent: false,
  },
  rights: {
    rightsEvidenceRef: f.sourceRef,
    editingAllowed: true,
    publicDistributionAllowed: true,
    paidAdvertisingAllowed: false,
    imageToVideoAllowed: false,
    referenceToVideoAllowed: false,
    expiresAt: null,
  },
});
const probe = {
  mediaType: "image" as const,
  technical: {
    contentType: "image/png",
    width: 100,
    height: 100,
    durationMs: null,
    fps: null,
    hasAudio: false,
  },
};
async function snapshot(f: F) {
  const [media, audits, links, records] = await Promise.all([
    db.select().from(productMediaAsset).where(eq(productMediaAsset.productId, f.productId)),
    db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, f.productId)),
    db
      .select()
      .from(schema.workspaceProjectEvidence)
      .where(eq(schema.workspaceProjectEvidence.projectId, f.projectId)),
    db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, f.productId)),
  ]);
  return { media, audits, links, records };
}
async function wait(pid: number) {
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
  throw Error("Observe actual lock wait");
}
let scenarios = 0;
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "drizzle" });
  for (const decision of ["approved", "rejected"]) {
    const f = await fixture();
    assert.equal(
      (await reviewProductMediaAction({ status: "idle", message: "" }, form(f, decision))).status,
      "success",
    );
    const after = await snapshot(f);
    assert.equal(after.media[0].reviewStatus, decision);
    assert.equal(after.media[0].version, 2);
    assert.equal(after.audits.length, 1);
    assert(after.links.some((l) => l.evidenceId === f.decisionRef));
    if (decision === "approved") {
      assert.equal(
        (await reviewProductMediaAction({ status: "idle", message: "" }, form(f, "rejected")))
          .status,
        "success",
      );
      assert.equal((await snapshot(f)).media[0].reviewStatus, "rejected");
      scenarios++;
    }
    scenarios++;
  }
  const changes = [
    "revoked",
    "banned",
    "demoted",
    "viewer",
    "member removed",
    "product link removed",
  ] as const;
  for (const op of ["register", "review"] as const)
    for (const change of changes) {
      const f = await fixture(op === "register" ? "user" : "admin"),
        c = await pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await c.query("BEGIN");
        await c.query(
          `SELECT id FROM ${op === "register" ? "aggregate_record" : "product_media_asset"} WHERE id=$1 FOR UPDATE`,
          [op === "register" ? f.productId : f.mediaId],
        );
        const {
          rows: [r],
        } = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending =
          op === "register"
            ? registerProductMediaAsset(input(f), probe, identity(f))
            : reviewProductMediaAction({ status: "idle", message: "" }, form(f));
        const rejected = op === "register" ? assert.rejects(pending) : undefined;
        await wait(r.pid);
        if (change === "revoked")
          await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
        else if (change === "banned")
          await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
        else if (change === "demoted")
          await db
            .update(schema.user)
            .set({ role: op === "review" ? "user" : "untrusted" })
            .where(eq(schema.user.id, f.actorId));
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
        else if (change === "member removed")
          await db
            .delete(schema.workspaceProjectMember)
            .where(
              and(
                eq(schema.workspaceProjectMember.projectId, f.projectId),
                eq(schema.workspaceProjectMember.userId, f.actorId),
              ),
            );
        else
          await db
            .delete(schema.workspaceProjectItem)
            .where(eq(schema.workspaceProjectItem.id, f.productLinkId));
        const before = await snapshot(f);
        await c.query("COMMIT");
        if (rejected) await rejected;
        else
          assert.deepEqual(await pending, {
            status: "error",
            message:
              "无法确认当前登录或产品媒体权限，本次请求未提交。请重新登录并确认项目权限后重试。",
          });
        assert.deepEqual(await snapshot(f), before);
        scenarios++;
      } finally {
        await c.query("ROLLBACK");
        c.release();
        await pending?.catch(() => undefined);
      }
    }
  for (const op of ["register", "review"] as const)
    for (const resource of ["product", "session", "evidence link"] as const) {
      const f = await fixture(),
        c = await pool.connect(),
        expires = new Date(Date.now() + 650);
      await db
        .update(schema.session)
        .set({ expiresAt: expires })
        .where(eq(schema.session.id, f.sessionId));
      let pending: Promise<unknown> | undefined;
      try {
        await c.query("BEGIN");
        if (resource === "evidence link") {
          if (op === "register")
            await db
              .delete(schema.workspaceProjectEvidence)
              .where(
                and(
                  eq(schema.workspaceProjectEvidence.projectId, f.projectId),
                  eq(schema.workspaceProjectEvidence.evidenceId, f.sourceRef),
                ),
              );
          await c.query("SELECT id FROM evidence WHERE id=$1 FOR UPDATE", [
            op === "register" ? f.sourceRef : f.decisionRef,
          ]);
        } else
          await c.query(
            `SELECT id FROM ${resource === "session" ? "session" : "aggregate_record"} WHERE id=$1 FOR UPDATE`,
            [resource === "session" ? f.sessionId : f.productId],
          );
        const {
          rows: [r],
        } = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending =
          op === "register"
            ? registerProductMediaAsset(input(f), probe, identity(f))
            : reviewProductMediaAction({ status: "idle", message: "" }, form(f));
        const rejected = op === "register" ? assert.rejects(pending) : undefined;
        await wait(r.pid);
        await delay(Math.max(1, expires.getTime() - Date.now() + 30));
        await c.query("ROLLBACK");
        const before = await snapshot(f);
        if (rejected) await rejected;
        else assert.equal(((await pending) as { status: string }).status, "error");
        assert.deepEqual(await snapshot(f), before);
        scenarios++;
      } finally {
        await c.query("ROLLBACK");
        c.release();
        await pending?.catch(() => undefined);
      }
    }
  for (const bad of ["actor only", "non-admin", "foreign evidence"]) {
    const f = await fixture(),
      other = await fixture();
    sid = f.sessionId;
    if (bad === "non-admin")
      await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, f.actorId));
    const before = await snapshot(f);
    await assert.rejects(
      reviewProductMediaAsset(
        {
          assetId: f.mediaId,
          decision: "approved",
          evidenceRef: bad === "foreign evidence" ? other.decisionRef : f.decisionRef,
          notes: "SYNTHETIC",
        },
        bad === "actor only" ? (f.actorId as never) : identity(f),
      ),
    );
    assert.deepEqual(await snapshot(f), before);
    scenarios++;
  }
  // Registration uses independently owned, persisted image evidence; both writer roles remain valid.
  for (const role of ["user", "admin"] as const) {
    const f = await fixture(role),
      ref = `evidence-synthetic-media-${randomUUID()}`;
    await db.insert(schema.evidence).values({
      id: ref,
      classification: "restricted",
      blobKey: `synthetic/${ref}`,
      contentType: "image/png",
      sha256: randomUUID(),
      sizeBytes: 8,
      sourceLabel: "SYNTHETIC registration",
      uploadedByType: "human",
      uploadedById: f.actorId,
    });
    const result = await registerProductMediaAsset(input(f, ref), probe, identity(f));
    assert.equal(result.review.status, "pending");
    assert.equal((await snapshot(f)).audits.length, 1);
    scenarios++;
  }
  for (const state of ["PRODUCT_DRAFT", "PRODUCT_REVISION_REQUIRED"]) {
    const f = await fixture();
    await db
      .update(productMediaAsset)
      .set({
        reviewStatus: "approved",
        reviewedBy: f.actorId,
        reviewedAt: new Date(),
        reviewEvidenceRef: f.decisionRef,
      })
      .where(eq(productMediaAsset.id, f.mediaId));
    await db
      .update(schema.aggregateRecord)
      .set({ state })
      .where(eq(schema.aggregateRecord.id, f.productId));
    assert.equal(
      (await reviewProductMediaAction({ status: "idle", message: "" }, form(f, "rejected"))).status,
      "success",
    );
    assert.equal((await snapshot(f)).media[0].reviewStatus, "rejected");
    scenarios++;
  }
  // Actual registration Action rechecks after its trusted media-probe adapter.
  for (const mode of [
    "user success",
    "admin success",
    "revoked",
    "banned",
    "invalid role",
    "membership removed",
  ] as const) {
    const f = await fixture(mode === "admin success" ? "admin" : "user"),
      receiptId = randomUUID();
    await db.insert(schema.videoUploadReceipt).values({
      id: receiptId,
      projectId: f.projectId,
      ownerId: f.actorId,
      blobPath: `synthetic/${receiptId}`,
      originalFilename: "synthetic.png",
      contentType: "image/png",
      sizeBytes: 8,
      rightsEvidenceRef: f.sourceRef,
      status: "uploaded",
      expiresAt: new Date(Date.now() + 60000),
    });
    const data = new FormData();
    for (const [k, v] of Object.entries({
      projectId: f.projectId,
      productId: f.productId,
      receiptId,
      origin: "factory",
      role: "product_hero",
      description: "SYNTHETIC registration Action",
      tags: "",
      productVisible: "true",
      logoVisible: "false",
      textPresent: "false",
      rightsEvidenceRef: f.sourceRef,
      editingAllowed: "true",
      publicDistributionAllowed: "true",
      paidAdvertisingAllowed: "false",
      imageToVideoAllowed: "false",
      referenceToVideoAllowed: "false",
      rightsExpiresAt: "",
    }))
      data.set(k, v);
    const before = await snapshot(f);
    if (!mode.endsWith("success"))
      duringProbe = async () => {
        if (mode === "revoked")
          await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
        else if (mode === "banned")
          await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
        else if (mode === "invalid role")
          await db
            .update(schema.user)
            .set({ role: "untrusted" })
            .where(eq(schema.user.id, f.actorId));
        else
          await db
            .delete(schema.workspaceProjectMember)
            .where(
              and(
                eq(schema.workspaceProjectMember.projectId, f.projectId),
                eq(schema.workspaceProjectMember.userId, f.actorId),
              ),
            );
      };
    const result = await registerProductMediaAction({ status: "idle", message: "" }, data);
    duringProbe = undefined;
    if (mode.endsWith("success")) {
      assert.equal(result.status, "success");
      assert.equal((await snapshot(f)).media.length, 2);
    } else {
      assert.equal(result.status, "error");
      assert.deepEqual(await snapshot(f), before);
    }
    scenarios++;
  }
  assert(!productMediaFailureMessage(new Error("SYNTHETIC secret")).includes("secret"));
  console.log(
    `PASS ${scenarios} actual ProductMedia review Action and domain cases: current administrator/writer identity, persisted evidence authorization, observed lock expiry, atomic media/evidence/audit writes, registration positives and revocation safety`,
  );
} finally {
  mock.restoreAll();
  await pool.end();
  await closeDatabase();
}
