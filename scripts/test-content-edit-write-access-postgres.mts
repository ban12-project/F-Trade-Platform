import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  authorizeLockedContentDraft,
  authorizeOwnedContentDraft,
  authorizeReadableContentDraftSource,
  CONTENT_DRAFT_ACCESS_MESSAGE,
  ContentDraftAccessError,
} from "../lib/content/draft-write-access";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { reviewProductDraft } from "../lib/product/verification";

const connection = process.env.CONTENT_EDIT_TEST_DATABASE_URL;
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
let operation: "revise" | "copy" = "revise";
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
const { createContentDraft, decideContentReview, reviseContentDraft, copyContentDraftToProject } =
  await import("../lib/content/store");
const { reviseContentDraftAction, copyContentDraftToProjectAction } = await import(
  "../lib/actions/content"
);
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
  const saved = await createContentDraft(contentInput, identity);
  await decideContentReview(
    {
      contentId: saved.id,
      approvalId: saved.approvalId,
      reviewedVersion: "1",
      decision: "rejected",
      evidenceRef: evidenceId,
      notes: "SYNTHETIC revision fixture",
    },
    identity,
  );
  let targetProjectId = projectId;
  if (operation === "copy") {
    targetProjectId = randomUUID();
    await db.insert(schema.workspaceProject).values({
      id: targetProjectId,
      title: "SYNTHETIC copy target",
      kind: "marketing",
      createdById: ownerId,
    });
    for (const [userId, role] of [
      [actorId, "editor"],
      [ownerId, "owner"],
    ] as const)
      await db.insert(schema.workspaceProjectMember).values({
        id: randomUUID(),
        projectId: targetProjectId,
        userId,
        role,
        createdById: ownerId,
      });
  }
  const editIdentity = { actorId, sessionId: sid, projectId: targetProjectId };
  const form = new FormData();
  for (const [key, value] of Object.entries(
    operation === "copy"
      ? { projectId: targetProjectId, sourceContentId: saved.id }
      : { projectId, contentId: saved.id, ...contentInput, body: "SYNTHETIC revised body" },
  ))
    form.set(key, value);
  sessionId = sid;
  return {
    actorId,
    ownerId,
    projectId: targetProjectId,
    sourceProjectId: projectId,
    productId,
    contentId: saved.id,
    identity: editIdentity,
    input: { ...contentInput, body: "SYNTHETIC revised body" },
    form,
    draft,
    content: saved.content,
    evidenceId,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function run(f: Fixture) {
  return operation === "revise"
    ? reviseContentDraftAction({ status: "idle", message: "" }, f.form)
    : copyContentDraftToProjectAction({ status: "idle", message: "" }, f.form);
}
async function state(f: Fixture) {
  const [products, contents, gates, events, audits, links, items, projects] = await Promise.all([
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
      .where(eq(schema.workspaceProjectEvidence.linkedById, f.actorId)),
    db
      .select()
      .from(schema.workspaceProjectItem)
      .where(
        sql`${schema.workspaceProjectItem.projectId} IN (${f.projectId}, ${f.sourceProjectId})`,
      ),
    db
      .select()
      .from(schema.workspaceProject)
      .where(sql`${schema.workspaceProject.id} IN (${f.projectId}, ${f.sourceProjectId})`)
      .orderBy(schema.workspaceProject.id),
  ]);
  return { products, contents, gates, events, audits, links, items, projects };
}
async function unchanged(f: Fixture, before: Awaited<ReturnType<typeof state>>) {
  assert.deepEqual(
    await state(f),
    before,
    "Source ProductReady, contents, Gates, workflows, audits, project timestamps and links remain unchanged",
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
  [
    "project edit role revoked",
    (f) =>
      db
        .update(schema.workspaceProjectMember)
        .set({ role: "viewer" })
        .where(
          and(
            eq(schema.workspaceProjectMember.projectId, f.projectId),
            eq(schema.workspaceProjectMember.userId, f.actorId),
          ),
        ),
  ],
  [
    "project membership removed",
    (f) =>
      db
        .delete(schema.workspaceProjectMember)
        .where(
          and(
            eq(schema.workspaceProjectMember.projectId, f.projectId),
            eq(schema.workspaceProjectMember.userId, f.actorId),
          ),
        ),
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
  assert.deepEqual(after.products, before.products);
  const target = after.contents.find((r) => r.id === result.contentId);
  assert(target);
  assert.equal(target.state, "CONTENT_REVIEW_REQUIRED");
  assert.equal(target.version, operation === "revise" ? 3 : 1);
  assert.deepEqual(target.payload.product_facts, f.content.product_facts);
  assert.equal(target.payload.body, operation === "revise" ? f.input.body : f.content.body);
  assert.equal(
    after.gates.filter((r) => r.aggregateId === target.id && r.status === "pending").length,
    1,
  );
  assert.equal(
    after.audits.filter(
      (r) =>
        r.aggregateId === target.id &&
        r.action ===
          (operation === "revise" ? "content_draft_revised" : "content_draft.copied_to_project"),
    ).length,
    1,
  );
  if (operation === "copy")
    assert.deepEqual(
      after.contents.find((r) => r.id === f.contentId),
      before.contents[0],
    );
  assert.deepEqual(after.links, before.links);
}

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (operation of ["revise", "copy"] as const) {
    await assertAllowed(await fixture());
    const businessUser = await fixture();
    await db
      .update(schema.user)
      .set({ role: "user" })
      .where(eq(schema.user.id, businessUser.actorId));
    await assertAllowed(businessUser);
    console.log(
      "PASS actual content edit Actions: admin/user editors preserve source facts and pending Gate requirements",
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
            f.contentId,
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
            `PASS in-flight ${role}/${label}: observed content lock wait, zero edit or copy writes and project-link changes`,
          );
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await pending;
        }
      }
    }
    for (const [label, change] of changes.slice(0, 4)) {
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
      const before = await state(f);
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
      operation === "revise"
        ? reviseContentDraft(direct.contentId, direct.input, { ...direct.identity, sessionId: "" })
        : copyContentDraftToProject(direct.contentId, { ...direct.identity, sessionId: "" }),
      ContentDraftAccessError,
    );
    await assert.rejects(
      operation === "revise"
        ? reviseContentDraft(direct.contentId, direct.input, {
            ...direct.identity,
            actorId: direct.ownerId,
          })
        : copyContentDraftToProject(direct.contentId, {
            ...direct.identity,
            actorId: direct.ownerId,
          }),
      ContentDraftAccessError,
    );
    await unchanged(direct, before);
    console.log(
      "PASS invalid-role/viewer/outsider/archive/kind/project/session-identity draft denials are atomic",
    );
    const sourceNotReady = await fixture();
    await db
      .update(schema.aggregateRecord)
      .set({ state: "PRODUCT_REVISION_REQUIRED" })
      .where(eq(schema.aggregateRecord.id, sourceNotReady.productId));
    const beforeSource = await state(sourceNotReady);
    assert.equal((await run(sourceNotReady)).status, "error");
    await unchanged(sourceNotReady, beforeSource);
    console.log(`PASS ${operation}/source no longer Ready: no edit or copy writes`);

    if (operation === "revise") {
      const wrongProject = await fixture();
      const targetId = randomUUID();
      await db.insert(schema.workspaceProject).values({
        id: targetId,
        title: "SYNTHETIC unrelated marketing project",
        kind: "marketing",
        createdById: wrongProject.ownerId,
      });
      await db.insert(schema.workspaceProjectMember).values({
        id: randomUUID(),
        projectId: targetId,
        userId: wrongProject.actorId,
        role: "editor",
        createdById: wrongProject.ownerId,
      });
      const beforeWrong = await state(wrongProject);
      await assert.rejects(
        reviseContentDraft(wrongProject.contentId, wrongProject.input, {
          ...wrongProject.identity,
          projectId: targetId,
        }),
        ContentDraftAccessError,
      );
      await unchanged(wrongProject, beforeWrong);
      for (const change of ["product changed", "unverified fact", "already pending"] as const) {
        const f = await fixture();
        if (change === "product changed") f.form.set("productId", randomUUID());
        if (change === "unverified fact") f.form.set("factPath", "product.unknown_synthetic_fact");
        if (change === "already pending") await assertAllowed(f);
        const before = await state(f);
        assert.equal((await run(f)).status, "error");
        await unchanged(f, before);
      }
      const concurrent = await fixture();
      const results = await Promise.all([run(concurrent), run(concurrent)]);
      assert.equal(results.filter((r) => r.status === "success").length, 1);
      assert.equal(results.filter((r) => r.status === "error").length, 1);
      const afterConcurrent = await state(concurrent);
      assert.equal(afterConcurrent.contents[0].version, 3);
      assert.equal(
        afterConcurrent.gates.filter(
          (r) => r.aggregateId === concurrent.contentId && r.status === "pending",
        ).length,
        1,
      );
      assert.equal(
        afterConcurrent.audits.filter((r) => r.action === "content_draft_revised").length,
        1,
      );
      console.log(
        "PASS revision owned-project, unchanged product, fact, state and concurrent single-commit guards",
      );
    } else {
      const readable = await fixture();
      await db
        .update(schema.user)
        .set({ role: "user" })
        .where(eq(schema.user.id, readable.actorId));
      await db
        .update(schema.workspaceProjectMember)
        .set({ role: "viewer" })
        .where(
          and(
            eq(schema.workspaceProjectMember.projectId, readable.sourceProjectId),
            eq(schema.workspaceProjectMember.userId, readable.actorId),
          ),
        );
      await assertAllowed(readable);
      const inaccessible = await fixture();
      const blocker = await lockPool.connect();
      let pending: ReturnType<typeof run> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
          inaccessible.productId,
        ]);
        const {
          rows: [backend],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending = run(inaccessible);
        await observeBlocked(backend.pid);
        await db
          .delete(schema.workspaceProjectMember)
          .where(
            and(
              eq(schema.workspaceProjectMember.projectId, inaccessible.sourceProjectId),
              eq(schema.workspaceProjectMember.userId, inaccessible.actorId),
            ),
          );
        const before = await state(inaccessible);
        await blocker.query("COMMIT");
        assert.equal((await pending).status, "error");
        await unchanged(inaccessible, before);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
      }
      const sameProject = await fixture();
      sameProject.form.set("projectId", sameProject.sourceProjectId);
      const beforeSame = await state(sameProject);
      assert.equal((await run(sameProject)).status, "error");
      await unchanged(sameProject, beforeSame);
      console.log(
        "PASS copying permits source viewer plus target editor, rejects lost source access and same-project duplication",
      );
    }

    // Date only is controlled; async waits, business/authorization row locks and DB are real.
    const clockStart = Date.now();
    mock.timers.enable({ apis: ["Date"], now: clockStart });
    try {
      for (const table of [
        "workspace_project",
        "aggregate_record",
        "source_product",
        "user",
        "session",
        "workspace_project_item",
        ...(operation === "copy" ? ["workspace_project_member" as const] : []),
      ] as const) {
        mock.timers.setTime(clockStart);
        const f = await fixture(60_000);
        const before = await state(f);
        const blocker = await lockPool.connect();
        let pending: ReturnType<typeof run> | undefined;
        try {
          await blocker.query("BEGIN");
          const [ownedLink] = await db
            .select({ id: schema.workspaceProjectItem.id })
            .from(schema.workspaceProjectItem)
            .where(eq(schema.workspaceProjectItem.aggregateId, f.contentId));
          const [sourceMembership] = await db
            .select({ id: schema.workspaceProjectMember.id })
            .from(schema.workspaceProjectMember)
            .where(
              and(
                eq(schema.workspaceProjectMember.projectId, f.sourceProjectId),
                eq(schema.workspaceProjectMember.userId, f.actorId),
              ),
            );
          const id =
            table === "workspace_project"
              ? f.projectId
              : table === "aggregate_record"
                ? f.contentId
                : table === "source_product"
                  ? f.productId
                  : table === "user"
                    ? f.actorId
                    : table === "session"
                      ? f.identity.sessionId
                      : table === "workspace_project_item"
                        ? ownedLink.id
                        : sourceMembership.id;
          const physicalTable = table === "source_product" ? "aggregate_record" : table;
          await blocker.query(`SELECT id FROM "${physicalTable}" WHERE id=$1 FOR UPDATE`, [id]);
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
            `PASS natural session expiry after observed ${table} lock wait: zero edit or copy writes`,
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
          .where(eq(schema.aggregateRecord.id, held.contentId))
          .for("update");
        if (operation === "revise")
          await authorizeOwnedContentDraft(tx, held.identity, held.contentId);
        else {
          await authorizeReadableContentDraftSource(tx, held.identity, held.sourceProjectId);
          await authorizeLockedContentDraft(tx, held.identity);
        }
        // A separate connection's update must wait until the authorization transaction ends.
        const revoker = await lockPool.connect();
        try {
          const {
            rows: [pid],
          } = await revoker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          revocation = revoker
            .query('UPDATE "user" SET role=$1 WHERE id=$2', [
              "unknown-synthetic-role",
              held.actorId,
            ])
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
      `PASS ${operation} current authorization; no remote requests; append-only audits retained`,
    );
  }
} finally {
  cachedSession = undefined;
  await lockPool.end();
  await closeDatabase();
  mock.restoreAll();
}
