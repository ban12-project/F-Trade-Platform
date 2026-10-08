import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as s from "../lib/db/schema";
import type { DocumentUploadIdentity } from "../lib/product/document-upload-access";
import { documentUploadPath } from "../lib/product/document-upload-contracts";

const connection = process.env.DOCUMENT_UPLOAD_ACCESS_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw Error("External delivery forbidden");
};
const db = getDatabase(),
  pool = new Pool({ connectionString: connection });
const bytes = Buffer.from("SYNTHETIC,ONLY\n");
let current: { user: typeof s.user.$inferSelect; session: typeof s.session.$inferSelect };
let readHook: () => Promise<void> = async () => {},
  signHook = readHook,
  presignHook = readHook;
let cacheFailure = false,
  reads = 0,
  signs = 0,
  validUntil = 0;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", {
  exports: {
    revalidatePath: () => {
      if (cacheFailure) throw Error("PRIVATE cache detail");
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: async () => current } } },
});
mock.module("@vercel/blob", {
  exports: {
    get: async () => {
      reads++;
      await readHook();
      return {
        statusCode: 200,
        blob: { contentType: "text/csv" },
        stream: new Blob([bytes]).stream(),
      };
    },
    issueSignedToken: async (options: { validUntil: number }) => {
      signs++;
      validUntil = options.validUntil;
      await signHook();
      return "SYNTHETIC bearer";
    },
  },
});
mock.module("@vercel/blob/client", {
  exports: {
    handleUploadPresigned: async ({
      body,
      getSignedToken,
    }: {
      body: { payload: { pathname: string; clientPayload: string } };
      getSignedToken: (path: string, payload: string) => Promise<unknown>;
    }) => {
      const signed = await getSignedToken(body.payload.pathname, body.payload.clientPayload);
      await presignHook();
      return { type: "blob.generate-presigned-url", presignedUrlPayload: signed };
    },
  },
});
const { uploadProductEvidenceAction: action } = await import("../lib/actions/product-evidence");
const { POST: signer } = await import("../app/api/product-documents/upload/route");
const { claimDocumentUpload: claim, issueDocumentUploadReceipt: issue } = await import(
  "../lib/product/document-upload-receipts"
);
async function fixture(role = "user") {
  const identity = { actorId: randomUUID(), sessionId: randomUUID(), projectId: randomUUID() };
  const [user] = await db
    .insert(s.user)
    .values({
      id: identity.actorId,
      name: "SYNTHETIC upload",
      email: `${identity.actorId}@example.invalid`,
      role,
    })
    .returning();
  const [session] = await db
    .insert(s.session)
    .values({
      id: identity.sessionId,
      userId: identity.actorId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  await db.insert(s.workspaceProject).values({
    id: identity.projectId,
    title: "SYNTHETIC upload",
    kind: "marketing",
    createdById: identity.actorId,
  });
  await db.insert(s.workspaceProjectMember).values({
    id: randomUUID(),
    projectId: identity.projectId,
    userId: identity.actorId,
    role: "owner",
    createdById: identity.actorId,
  });
  current = { user, session };
  return identity;
}
function payload(f: DocumentUploadIdentity, purpose = "evidence") {
  return {
    receiptId: randomUUID(),
    projectId: f.projectId,
    purpose,
    originalFilename: "synthetic.csv",
    contentType: "text/csv",
    sizeBytes: bytes.length,
  };
}
function run(f: DocumentUploadIdentity, receiptId: string) {
  const fd = new FormData();
  fd.set("projectId", f.projectId);
  fd.set("receiptId", receiptId);
  return action({ status: "idle", message: "" }, fd);
}
function sign(f: DocumentUploadIdentity) {
  const p = payload(f);
  return signer(
    new Request("http://127.0.0.1:3141/api/product-documents/upload", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3141", "content-type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-presigned-url",
        payload: {
          pathname: documentUploadPath(p as Parameters<typeof documentUploadPath>[0]),
          clientPayload: JSON.stringify(p),
        },
      }),
    }),
  );
}
async function snapshot(f: DocumentUploadIdentity) {
  const r = await db.execute(
    sql`SELECT (SELECT count(*)::int FROM evidence WHERE uploaded_by_id=${f.actorId}) AS evidence, (SELECT count(*)::int FROM workspace_project_evidence WHERE project_id=${f.projectId}) AS links, (SELECT count(*)::int FROM product_document_upload_receipt WHERE owner_id=${f.actorId} AND evidence_id IS NOT NULL) AS claimed`,
  );
  return r.rows[0];
}
async function observeWait(pid: number) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const {
      rows: [{ blocked }],
    } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (blocked) return;
    assert(Date.now() < deadline, "Actual PostgreSQL wait required");
    await delay(10);
  }
}
async function revoke(f: DocumentUploadIdentity, change: string, receiptId?: string) {
  const member = and(
    eq(s.workspaceProjectMember.projectId, f.projectId),
    eq(s.workspaceProjectMember.userId, f.actorId),
  );
  if (change === "revoked") await db.delete(s.session).where(eq(s.session.id, f.sessionId));
  if (change === "role")
    await db.update(s.user).set({ role: "synthetic-denied" }).where(eq(s.user.id, f.actorId));
  if (change === "banned")
    await db.update(s.user).set({ banned: true }).where(eq(s.user.id, f.actorId));
  if (change === "expired")
    await db
      .update(s.session)
      .set({ expiresAt: new Date(0) })
      .where(eq(s.session.id, f.sessionId));
  if (change === "shortened")
    await db
      .update(s.session)
      .set({ expiresAt: new Date(Date.now() + 5000) })
      .where(eq(s.session.id, f.sessionId));
  if (change === "wrong-session") {
    const [other] = await db
      .insert(s.user)
      .values({
        id: randomUUID(),
        name: "SYNTHETIC other",
        email: `${randomUUID()}@example.invalid`,
        role: "user",
      })
      .returning();
    await db.update(s.session).set({ userId: other.id }).where(eq(s.session.id, f.sessionId));
  }
  if (change === "viewer")
    await db.update(s.workspaceProjectMember).set({ role: "viewer" }).where(member);
  if (change === "removed") await db.delete(s.workspaceProjectMember).where(member);
  if (change === "archived")
    await db
      .update(s.workspaceProject)
      .set({ status: "archived" })
      .where(eq(s.workspaceProject.id, f.projectId));
  if (change === "kind")
    await db
      .update(s.workspaceProject)
      .set({ kind: "sales" })
      .where(eq(s.workspaceProject.id, f.projectId));
  if (receiptId && change.startsWith("receipt-")) {
    const updates: Record<string, object> = {
      "receipt-owner": { ownerId: randomUUID() },
      "receipt-project": { projectId: randomUUID() },
      "receipt-purpose": { purpose: "agent" },
      "receipt-path": { blobPath: `SYNTHETIC-${randomUUID()}` },
      "receipt-filename": { originalFilename: "different.csv" },
      "receipt-type": { contentType: "application/pdf" },
      "receipt-size": { sizeBytes: bytes.length + 1 },
      "receipt-expired": { expiresAt: new Date(0) },
      "receipt-extended": { expiresAt: new Date(Date.now() + 3_600_000) },
    };
    if (change === "receipt-owner") {
      const [other] = await db
        .insert(s.user)
        .values({
          id: randomUUID(),
          name: "SYNTHETIC other",
          email: `${randomUUID()}@example.invalid`,
          role: "user",
        })
        .returning();
      updates[change] = { ownerId: other.id };
    }
    if (change === "receipt-project") {
      const [other] = await db
        .insert(s.workspaceProject)
        .values({
          id: randomUUID(),
          title: "SYNTHETIC other",
          kind: "marketing",
          createdById: f.actorId,
        })
        .returning();
      updates[change] = { projectId: other.id };
    }
    await db
      .update(s.productDocumentUploadReceipt)
      .set(updates[change])
      .where(eq(s.productDocumentUploadReceipt.id, receiptId));
  }
}
let count = 0;
try {
  await migrate(db, { migrationsFolder: "drizzle" });
  for (const role of ["user", "admin"])
    for (const purpose of ["evidence", "agent"]) {
      const f = await fixture(role),
        p = payload(f, purpose),
        r = await issue(p, f, db);
      if (purpose === "evidence") assert.equal((await run(f, r.id)).status, "success");
      else await claim({ receiptId: r.id, projectId: f.projectId, purpose }, f, db);
      assert.deepEqual(await snapshot(f), { evidence: 1, links: 1, claimed: 1 });
      count++;
    }
  for (const change of [
    "revoked",
    "role",
    "banned",
    "expired",
    "wrong-session",
    "viewer",
    "removed",
    "archived",
    "kind",
    "receipt-owner",
    "receipt-project",
    "receipt-purpose",
    "receipt-path",
    "receipt-filename",
    "receipt-type",
    "receipt-size",
    "receipt-expired",
    "receipt-extended",
  ]) {
    const f = await fixture(),
      r = await issue(payload(f), f, db),
      before = await snapshot(f);
    readHook = () => revoke(f, change, r.id);
    try {
      assert.equal((await run(f, r.id)).status, "error");
      assert.deepEqual(await snapshot(f), before);
      count++;
    } finally {
      readHook = async () => {};
    }
  }
  // Cached request identity is insufficient for both issuance and final claim.
  for (const change of ["revoked", "role", "banned", "wrong-session", "expired"]) {
    const f = await fixture(),
      held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [f.actorId]);
    try {
      const pending = sign(f);
      await observeWait(pid);
      if (change === "role" || change === "banned")
        await held.query(
          `UPDATE "user" SET ${change === "role" ? "role='synthetic-denied'" : "banned=true"} WHERE id=$1`,
          [f.actorId],
        );
      else await revoke(f, change);
      await held.query("COMMIT");
      assert.equal((await pending).status, 400);
      assert.deepEqual(await snapshot(f), { evidence: 0, links: 0, claimed: 0 });
      const rows = await db
        .select()
        .from(s.productDocumentUploadReceipt)
        .where(eq(s.productDocumentUploadReceipt.ownerId, f.actorId));
      assert.equal(rows.length, 0);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  for (const change of ["viewer", "removed", "archived", "kind", "natural-expiry"]) {
    const f = await fixture(),
      held = await pool.connect();
    if (change === "natural-expiry")
      await db
        .update(s.session)
        .set({ expiresAt: new Date(Date.now() + 500) })
        .where(eq(s.session.id, f.sessionId));
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM workspace_project WHERE id=$1 FOR UPDATE", [f.projectId]);
    try {
      const pending = sign(f);
      await observeWait(pid);
      if (change === "viewer" || change === "removed")
        await held.query(
          change === "viewer"
            ? "UPDATE workspace_project_member SET role='viewer' WHERE project_id=$1 AND user_id=$2"
            : "DELETE FROM workspace_project_member WHERE project_id=$1 AND user_id=$2",
          [f.projectId, f.actorId],
        );
      else if (change === "natural-expiry") await delay(550);
      else
        await held.query(
          `UPDATE workspace_project SET ${change === "kind" ? "kind='sales'" : "status='archived'"} WHERE id=$1`,
          [f.projectId],
        );
      await held.query("COMMIT");
      assert.equal((await pending).status, 400);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  for (const phase of ["sign", "presign"] as const)
    for (const change of ["revoked", "role", "expired", "shortened", "viewer"]) {
      const f = await fixture(),
        before = await snapshot(f);
      if (phase === "sign") signHook = () => revoke(f, change);
      else presignHook = () => revoke(f, change);
      try {
        const response = await sign(f);
        assert.equal(response.status, 400);
        const text = await response.text();
        assert(!text.includes("bearer"));
        assert.deepEqual(await snapshot(f), before);
        count++;
      } finally {
        signHook = presignHook = async () => {};
      }
    }
  {
    const f = await fixture();
    const expiry = new Date(Date.now() + 60_000);
    await db.update(s.session).set({ expiresAt: expiry }).where(eq(s.session.id, f.sessionId));
    assert.equal((await sign(f)).status, 200);
    assert.equal(validUntil, expiry.getTime());
    count++;
  }
  {
    const f = await fixture(),
      r = await issue(payload(f), f, db),
      before = reads;
    readHook = async () => {
      await revoke(f, "revoked");
      throw Object.assign(Error("SYNTHETIC transport"), { code: "ECONNRESET" });
    };
    try {
      assert.equal((await run(f, r.id)).status, "error");
      assert.equal(reads, before + 1);
      count++;
    } finally {
      readHook = async () => {};
    }
  }
  // Wait on the receipt after verified bytes arrive; natural deadlines are rechecked.
  for (const deadline of ["session", "receipt"]) {
    const f = await fixture(),
      expiry = new Date(Date.now() + 800);
    const r = await issue(payload(f), f, db),
      held = await pool.connect();
    if (deadline === "session")
      await db.update(s.session).set({ expiresAt: expiry }).where(eq(s.session.id, f.sessionId));
    else
      await db
        .update(s.productDocumentUploadReceipt)
        .set({ expiresAt: expiry })
        .where(eq(s.productDocumentUploadReceipt.id, r.id));
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT id FROM product_document_upload_receipt WHERE id=$1 FOR UPDATE", [
      r.id,
    ]);
    try {
      const before = await snapshot(f),
        pending = run(f, r.id);
      await observeWait(pid);
      await delay(Math.max(0, expiry.getTime() - Date.now() + 20));
      await held.query("COMMIT");
      assert.equal((await pending).status, "error");
      assert.deepEqual(await snapshot(f), before);
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  }
  // Stall the last receipt statement after evidence and link writes. All must roll back.
  for (const change of [
    "session",
    "receipt",
    "reserved-session",
    "reserved-role",
    "reserved-member",
  ]) {
    const f = await fixture(),
      r = await issue(payload(f), f, db),
      name = `synthetic_upload_${randomUUID().replaceAll("-", "")}`,
      key = Date.now();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${r.id}' AND NEW.evidence_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE UPDATE ON product_document_upload_receipt FOR EACH ROW EXECUTE FUNCTION ${name}();`,
      ),
    );
    const held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
    let reservation: Promise<unknown> | undefined;
    try {
      const expiry = new Date(Date.now() + 1000),
        reserved = change.startsWith("reserved-");
      if (change === "session")
        await db.update(s.session).set({ expiresAt: expiry }).where(eq(s.session.id, f.sessionId));
      if (change === "receipt")
        await db
          .update(s.productDocumentUploadReceipt)
          .set({ expiresAt: expiry })
          .where(eq(s.productDocumentUploadReceipt.id, r.id));
      const before = await snapshot(f),
        pending = run(f, r.id);
      await observeWait(pid);
      if (reserved) {
        const other = await pool.connect();
        const {
          rows: [{ pid: otherPid }],
        } = await other.query("SELECT pg_backend_pid() AS pid");
        const query =
          change === "reserved-session"
            ? ["DELETE FROM session WHERE id=$1", [f.sessionId]]
            : change === "reserved-role"
              ? ["UPDATE \"user\" SET role='synthetic-denied' WHERE id=$1", [f.actorId]]
              : [
                  "UPDATE workspace_project_member SET role='viewer' WHERE project_id=$1 AND user_id=$2",
                  [f.projectId, f.actorId],
                ];
        reservation = other
          .query(query[0] as string, query[1] as string[])
          .finally(() => other.release());
        const stop = Date.now() + 5000;
        for (;;) {
          const {
            rows: [{ waiting }],
          } = await pool.query("SELECT cardinality(pg_blocking_pids($1))>0 AS waiting", [otherPid]);
          if (waiting) break;
          assert(Date.now() < stop);
          await delay(10);
        }
      } else await delay(Math.max(0, expiry.getTime() - Date.now() + 20));
      await held.query("COMMIT");
      const result = await pending;
      if (reserved) {
        assert.equal(result.status, "success");
        await reservation;
        assert.deepEqual(await snapshot(f), { evidence: 1, links: 1, claimed: 1 });
      } else {
        assert.equal(result.status, "error");
        assert.deepEqual(await snapshot(f), before);
      }
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
      await reservation;
      await db.execute(
        sql.raw(
          `DROP TRIGGER ${name} ON product_document_upload_receipt; DROP FUNCTION ${name}();`,
        ),
      );
    }
  }
  {
    const f = await fixture(),
      r = await issue(payload(f), f, db);
    cacheFailure = true;
    try {
      assert.equal((await run(f, r.id)).status, "success");
      assert.deepEqual(await snapshot(f), { evidence: 1, links: 1, claimed: 1 });
      count++;
    } finally {
      cacheFailure = false;
    }
  }
  for (const legacy of ["actor-only", "wrong-session", "wrong-project"]) {
    const f = await fixture(),
      input =
        legacy === "actor-only"
          ? f.actorId
          : { ...f, [legacy === "wrong-session" ? "sessionId" : "projectId"]: randomUUID() };
    await assert.rejects(issue(payload(f), input as DocumentUploadIdentity, db));
    count++;
  }
  // Expiry while the receipt INSERT waits must undo the reservation itself.
  {
    const f = await fixture(),
      name = `synthetic_issue_${randomUUID().replaceAll("-", "")}`,
      key = Date.now();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.actorId}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON product_document_upload_receipt FOR EACH ROW EXECUTE FUNCTION ${name}();`,
      ),
    );
    const held = await pool.connect();
    await held.query("BEGIN");
    const {
      rows: [{ pid }],
    } = await held.query("SELECT pg_backend_pid() AS pid");
    await held.query("SELECT pg_advisory_xact_lock($1)", [key]);
    try {
      const expiry = new Date(Date.now() + 1000);
      await db.update(s.session).set({ expiresAt: expiry }).where(eq(s.session.id, f.sessionId));
      const pending = sign(f);
      await observeWait(pid);
      await delay(Math.max(0, expiry.getTime() - Date.now() + 20));
      await held.query("COMMIT");
      assert.equal((await pending).status, 400);
      assert.equal(
        (
          await db
            .select()
            .from(s.productDocumentUploadReceipt)
            .where(eq(s.productDocumentUploadReceipt.ownerId, f.actorId))
        ).length,
        0,
      );
      count++;
    } finally {
      await held.query("ROLLBACK");
      held.release();
      await db.execute(
        sql.raw(
          `DROP TRIGGER ${name} ON product_document_upload_receipt; DROP FUNCTION ${name}();`,
        ),
      );
    }
  }
  assert(signs > 0);
  console.log(
    `PASS ${count} actual upload Action/signer/PostgreSQL identity, metadata, expiry, reservation and atomic rollback cases`,
  );
} finally {
  await closeDatabase();
  await pool.end();
}
