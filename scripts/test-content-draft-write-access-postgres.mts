import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  authorizeLockedContentDraft,
  CONTENT_DRAFT_ACCESS_MESSAGE,
  ContentDraftAccessError,
} from "../lib/content/draft-write-access";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { reviewProductDraft } from "../lib/product/verification";

const connection = process.env.CONTENT_DRAFT_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw new Error("Remote requests forbidden in synthetic content review tests");
};
const db = getDatabase();
const lockPool = new Pool({ connectionString: connection });
let sessionId = "";
type Snapshot = {
  user: typeof schema.user.$inferSelect;
  session: typeof schema.session.$inferSelect;
};
let cachedSession: Snapshot | undefined;
async function readSession() {
  const [row] = await db
    .select()
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.id, sessionId));
  return row && !row.user.banned && row.session.expiresAt > new Date() ? row : null;
}
const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
// Actual Action/authz, source and version gates, transaction, locks, DB and audit.
// Only Next request/cache and auth transport are adapted to real synthetic DB rows.
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", { exports: { revalidatePath: () => {} } });
mock.module(moduleUrl("../lib/auth.ts"), {
  exports: {
    auth: { api: { getSession: async () => cachedSession ?? readSession() } },
  },
});
const { createProductAgentDraft, decideProductCatalogReview } = await import("../lib/products");
const { createContentDraft } = await import("../lib/content/store");
const { createContentDraftAction } = await import("../lib/actions/content");
const source = JSON.parse(
  await readFile("data/fixtures/product-draft-complete.synthetic.json", "utf8"),
);
async function fixture(lifetime = 3_600_000) {
  const actorId = randomUUID(),
    ownerId = randomUUID(),
    projectId = randomUUID(),
    sid = randomUUID(),
    productId = randomUUID();
  const evidenceId = `evidence-synthetic-review-source-${randomUUID()}`;
  for (const [id, role] of [
    [actorId, "admin"],
    [ownerId, "user"],
  ])
    await db.insert(schema.user).values({
      id,
      name: "SYNTHETIC review guard",
      email: `${id}@example.invalid`,
      emailVerified: true,
      role,
    });
  await db.insert(schema.session).values({
    id: sid,
    userId: actorId,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + lifetime),
  });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    title: "SYNTHETIC review guard",
    kind: "marketing",
    createdById: ownerId,
  });
  for (const [userId, role] of [
    [actorId, "editor"],
    [ownerId, "owner"],
  ] as const)
    await db
      .insert(schema.workspaceProjectMember)
      .values({ id: randomUUID(), projectId, userId, role, createdById: ownerId });
  for (const id of [evidenceId])
    await db.insert(schema.evidence).values({
      id,
      classification: "internal",
      blobKey: `synthetic/${id}`,
      contentType: "text/plain",
      sha256: createHash("sha256").update(id).digest("hex"),
      sizeBytes: 1,
      sourceLabel: "SYNTHETIC review guard",
      uploadedByType: "human",
      uploadedById: actorId,
    });
  await db
    .insert(schema.workspaceProjectEvidence)
    .values({ id: randomUUID(), projectId, evidenceId, linkedById: actorId });
  const draft = reviewProductDraft({
    ...source,
    record_id: productId,
    source_ref: "source-synthetic-review-guard",
    evidence_refs: [evidenceId],
    field_evidence: Object.fromEntries(
      Object.keys(source.field_evidence).map((key) => [key, evidenceId]),
    ),
    product: { ...source.product, product_name: "SYNTHETIC review guard fixture" },
  });
  const identity = { actorId, sessionId: sid, projectId };
  const savedProduct = await createProductAgentDraft(draft, identity, { synthetic: true });
  await decideProductCatalogReview(
    {
      productId,
      approvalId: savedProduct.approvalId,
      reviewedVersion: "1",
      decision: "approved",
      evidenceRef: evidenceId,
      notes: "SYNTHETIC fixture product decision",
    },
    identity,
  );
  const contentInput = {
    productId,
    contentType: "product" as const,
    factPath: "product.product_name",
    objective: "SYNTHETIC content review",
    targetCustomer: "SYNTHETIC test-only buyer",
    hook: "SYNTHETIC marketing copy",
    body: "SYNTHETIC body for review",
    callToAction: "SYNTHETIC workflow inquiry",
    hashtags: "#Synthetic",
    visualInstruction: "SYNTHETIC text card",
  };
  const form = new FormData();
  for (const [key, value] of Object.entries({ projectId, ...contentInput })) form.set(key, value);
  sessionId = sid;
  return {
    actorId,
    ownerId,
    projectId,
    productId,
    identity,
    input: contentInput,
    form,
    draft,
    evidenceId,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function run(f: Fixture) {
  return createContentDraftAction({ status: "idle", message: "" }, f.form);
}
async function state(f: Fixture) {
  const [products, contents, gates, events, audits, links, items] = await Promise.all([
    db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, f.productId)),
    db
      .select()
      .from(schema.aggregateRecord)
      .where(
        and(
          eq(schema.aggregateRecord.type, "content"),
          eq(schema.aggregateRecord.createdById, f.actorId),
        ),
      ),
    db.select().from(schema.approval).where(eq(schema.approval.requestedById, f.actorId)),
    db.select().from(schema.workflowEvent).where(eq(schema.workflowEvent.actorId, f.actorId)),
    db.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorId, f.actorId)),
    db
      .select()
      .from(schema.workspaceProjectEvidence)
      .where(eq(schema.workspaceProjectEvidence.projectId, f.projectId)),
    db
      .select()
      .from(schema.workspaceProjectItem)
      .where(eq(schema.workspaceProjectItem.projectId, f.projectId)),
  ]);
  return { products, contents, gates, events, audits, links, items };
}
async function unchanged(f: Fixture, before: Awaited<ReturnType<typeof state>>) {
  assert.deepEqual(
    await state(f),
    before,
    "Source ProductReady, contents, Gates, workflows, audits and project links remain unchanged",
  );
}
const changes: Array<[string, (f: Fixture) => Promise<unknown>]> = [
  [
    "writer role invalidated",
    (f) =>
      db
        .update(schema.user)
        .set({ role: "unknown-synthetic-role" })
        .where(eq(schema.user.id, f.actorId)),
  ],
  [
    "session revoked",
    (f) => db.delete(schema.session).where(eq(schema.session.id, f.identity.sessionId)),
  ],
  [
    "account banned",
    (f) => db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId)),
  ],
  [
    "session expired",
    (f) =>
      db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(schema.session.id, f.identity.sessionId)),
  ],
];
async function observeBlocked(pid: number) {
  const deadline = performance.now() + 5_000;
  do {
    const {
      rows: [row],
    } = await lockPool.query<{ blocked: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (row.blocked) return;
    await delay(10);
  } while (performance.now() < deadline);
  throw new Error("Expected actual PostgreSQL lock wait was not observed");
}
async function assertAllowed(f: Fixture) {
  const before = await state(f);
  const result = await run(f);
  assert.equal(result.status, "success");
  const after = await state(f);
  assert.deepEqual(
    after.products,
    before.products,
    "Source ProductReady and evidence remain immutable",
  );
  assert.equal(after.contents.length, 1);
  const content = after.contents[0];
  assert.equal(content.id, result.contentId);
  assert.equal(content.state, "CONTENT_REVIEW_REQUIRED");
  assert.equal(content.version, 1);
  assert.deepEqual(content.payload.product_facts, [
    {
      field: "product.product_name",
      value: f.draft.product.product_name,
      evidence_ref: f.evidenceId,
    },
  ]);
  assert.equal(content.payload.body, f.input.body);
  assert.equal(after.gates.filter((r) => r.aggregateId === content.id)[0].status, "pending");
  assert.equal(after.events.filter((r) => r.aggregateId === content.id).length, 1);
  assert.equal(
    after.audits.filter((r) => r.aggregateId === content.id && r.action === "content_draft_created")
      .length,
    1,
  );
  assert.equal(
    after.items.filter(
      (r) =>
        r.aggregateId === content.id && r.role === "marketing_content" && r.relation === "owned",
    ).length,
    1,
  );
  assert.deepEqual(after.links, before.links);
}

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await assertAllowed(await fixture());
  const businessUser = await fixture();
  await db
    .update(schema.user)
    .set({ role: "user" })
    .where(eq(schema.user.id, businessUser.actorId));
  await assertAllowed(businessUser);
  console.log(
    "PASS actual manual content Action: admin/user editors create pending drafts from unchanged ProductReady facts",
  );
  for (const role of ["admin", "user"] as const) {
    for (const [label, change] of changes) {
      const f = await fixture();
      await db.update(schema.user).set({ role }).where(eq(schema.user.id, f.actorId));
      const before = await state(f);
      const blocker = await lockPool.connect();
      let pending: ReturnType<typeof run> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
          f.productId,
        ]);
        const {
          rows: [backend],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending = run(f);
        await observeBlocked(backend.pid);
        await change(f);
        await blocker.query("COMMIT");
        assert.deepEqual(await pending, {
          status: "error",
          message: CONTENT_DRAFT_ACCESS_MESSAGE,
        });
        await unchanged(f, before);
        console.log(
          `PASS in-flight ${role}/${label}: observed product source lock wait, zero content creation or project-link changes`,
        );
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
      }
    }
  }
  for (const [label, change] of changes) {
    const f = await fixture();
    const before = await state(f);
    const snapshot = await readSession();
    assert(snapshot);
    cachedSession = snapshot;
    await change(f);
    assert.deepEqual(await run(f), { status: "error", message: CONTENT_DRAFT_ACCESS_MESSAGE });
    cachedSession = undefined;
    await unchanged(f, before);
    console.log(
      `PASS stale initial authentication transport/${label}: current DB authorization wins`,
    );
  }
  for (const change of ["invalid role", "viewer", "outsider", "archived", "sales"] as const) {
    const f = await fixture();
    const before = await state(f);
    if (change === "invalid role")
      await db
        .update(schema.user)
        .set({ role: "unknown-synthetic-role" })
        .where(eq(schema.user.id, f.actorId));
    if (change === "viewer")
      await db
        .update(schema.workspaceProjectMember)
        .set({ role: "viewer" })
        .where(
          and(
            eq(schema.workspaceProjectMember.projectId, f.projectId),
            eq(schema.workspaceProjectMember.userId, f.actorId),
          ),
        );
    if (change === "outsider")
      await db
        .delete(schema.workspaceProjectMember)
        .where(
          and(
            eq(schema.workspaceProjectMember.projectId, f.projectId),
            eq(schema.workspaceProjectMember.userId, f.actorId),
          ),
        );
    if (change === "archived")
      await db
        .update(schema.workspaceProject)
        .set({ status: "archived" })
        .where(eq(schema.workspaceProject.id, f.projectId));
    if (change === "sales")
      await db
        .update(schema.workspaceProject)
        .set({ kind: "sales" })
        .where(eq(schema.workspaceProject.id, f.projectId));
    assert.equal((await run(f)).status, "error");
    await unchanged(f, before);
  }
  for (const projectId of [undefined, "", "invalid", randomUUID()]) {
    const f = await fixture();
    const before = await state(f);
    if (projectId === undefined) f.form.delete("projectId");
    else f.form.set("projectId", projectId);
    assert.equal((await run(f)).status, "error");
    await unchanged(f, before);
  }
  const direct = await fixture();
  const before = await state(direct);
  await assert.rejects(
    createContentDraft(direct.input, { ...direct.identity, sessionId: "" }),
    ContentDraftAccessError,
  );
  await assert.rejects(
    createContentDraft(direct.input, { ...direct.identity, actorId: direct.ownerId }),
    ContentDraftAccessError,
  );
  await unchanged(direct, before);
  console.log(
    "PASS invalid-role/viewer/outsider/archive/kind/project/session-identity draft denials are atomic",
  );
  for (const invalid of [
    "wrong project source",
    "product no longer Ready",
    "unknown fact",
  ] as const) {
    const f = await fixture();
    if (invalid === "wrong project source")
      await db
        .delete(schema.workspaceProjectItem)
        .where(eq(schema.workspaceProjectItem.aggregateId, f.productId));
    if (invalid === "product no longer Ready")
      await db
        .update(schema.aggregateRecord)
        .set({ state: "PRODUCT_REVISION_REQUIRED" })
        .where(eq(schema.aggregateRecord.id, f.productId));
    if (invalid === "unknown fact") f.form.set("factPath", "product.unsupported");
    const before = await state(f);
    assert.equal((await run(f)).status, "error");
    await unchanged(f, before);
    console.log(`PASS ${invalid}: no content writes or source changes`);
  }

  // Date only is controlled; async waits, business/authorization row locks and DB are real.
  const clockStart = Date.now();
  mock.timers.enable({ apis: ["Date"], now: clockStart });
  try {
    for (const table of ["workspace_project", "aggregate_record", "user", "session"] as const) {
      mock.timers.setTime(clockStart);
      const f = await fixture(60_000);
      const before = await state(f);
      const blocker = await lockPool.connect();
      let pending: ReturnType<typeof run> | undefined;
      try {
        await blocker.query("BEGIN");
        const id =
          table === "workspace_project"
            ? f.projectId
            : table === "aggregate_record"
              ? f.productId
              : table === "user"
                ? f.actorId
                : f.identity.sessionId;
        await blocker.query(`SELECT id FROM "${table}" WHERE id=$1 FOR UPDATE`, [id]);
        const {
          rows: [backend],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending = run(f);
        await observeBlocked(backend.pid);
        mock.timers.setTime(clockStart + 60_000);
        await blocker.query("COMMIT");
        assert.deepEqual(await pending, {
          status: "error",
          message: CONTENT_DRAFT_ACCESS_MESSAGE,
        });
        await unchanged(f, before);
        console.log(
          `PASS natural session expiry after observed ${table} lock wait: zero content creation`,
        );
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
      }
    }
  } finally {
    mock.timers.reset();
  }

  const held = await fixture();
  let revocation: Promise<unknown> | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(schema.aggregateRecord)
        .where(eq(schema.aggregateRecord.id, held.productId))
        .for("update");
      await authorizeLockedContentDraft(tx, held.identity);
      // A separate connection's update must wait until the authorization transaction ends.
      const revoker = await lockPool.connect();
      try {
        const {
          rows: [pid],
        } = await revoker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        revocation = revoker
          .query('UPDATE "user" SET role=$1 WHERE id=$2', ["unknown-synthetic-role", held.actorId])
          .finally(() => revoker.release());
        const deadline = performance.now() + 5_000;
        let blocked = false;
        do {
          const {
            rows: [row],
          } = await lockPool.query<{ blocked: boolean }>(
            "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
            [pid.pid],
          );
          blocked = row.blocked;
          if (blocked) break;
          await delay(10);
        } while (performance.now() < deadline);
        assert(blocked, "Reviewer role reservation held until transaction completion");
      } catch (error) {
        if (!revocation) revoker.release();
        throw error;
      }
    });
  } finally {
    await revocation;
  }
  console.log(
    "PASS current draft authorization locks serialize revocation until transaction completion",
  );
  console.log(
    "PASS synthetic manual content current authorization; no remote requests; append-only audits retained",
  );
} finally {
  cachedSession = undefined;
  await lockPool.end();
  await closeDatabase();
  mock.restoreAll();
}
