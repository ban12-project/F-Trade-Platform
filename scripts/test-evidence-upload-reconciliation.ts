import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../lib/db/client";
import { evidence, evidenceUploadIntent } from "../lib/db/schema";
import { MemoryEvidenceStore } from "../lib/evidence/memory-store";
import { persistUploadedEvidence } from "../lib/evidence/persist-upload";
import type { EvidenceWrite } from "../lib/evidence/store";
import { reconcileEvidenceUpload } from "../lib/evidence/upload-reconciliation";

export async function testUploadReconciliation(db: Database, actorId: string) {
  const body = new Blob(["SYNTHETIC reconciliation bytes"]);
  const input = {
    actorId,
    filename: "synthetic.csv",
    contentType: "text/csv",
    sha256: createHash("sha256")
      .update(await body.text())
      .digest("hex"),
    sizeBytes: body.size,
    sourceLabel: "synthetic-reconciliation",
    body,
  };
  const memory = new MemoryEvidenceStore();
  const ids: string[] = [];
  let currentId = "";
  let deletes = 0;
  const store = {
    async put(value: EvidenceWrite) {
      currentId = value.evidenceId;
      ids.push(currentId);
      const [intent] = await db
        .select()
        .from(evidenceUploadIntent)
        .where(eq(evidenceUploadIntent.id, currentId));
      assert.equal(intent.status, "upload_pending", "intent must exist before external write");
      assert.equal(intent.blobKey, value.pathname);
      return memory.put(value);
    },
    async delete(path: string) {
      deletes++;
      memory.values.delete(path);
    },
  };
  const intent = async (id = currentId) => {
    const [row] = await db
      .select()
      .from(evidenceUploadIntent)
      .where(eq(evidenceUploadIntent.id, id));
    assert.ok(row);
    return row;
  };
  // Force an actual PostgreSQL CHECK violation inside the production transaction.
  const rejected = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return (operation: (tx: DatabaseTransaction) => Promise<unknown>) =>
          target.transaction((tx) =>
            operation(
              new Proxy(tx, {
                get(transaction, member, context) {
                  if (member === "insert")
                    return (table: typeof evidence) => {
                      if (table !== evidence) return transaction.insert(table);
                      return {
                        values: (value: typeof evidence.$inferInsert) =>
                          transaction.insert(evidence).values({ ...value, uploadedById: "" }),
                      };
                    };
                  return Reflect.get(transaction, member, context);
                },
              }),
            ),
          );
      return Reflect.get(target, key, receiver);
    },
  }) as Database;
  try {
    const id = await persistUploadedEvidence(input, db, store);
    assert.equal((await intent(id)).status, "attached");
    await reconcileEvidenceUpload(id, db, store);
    assert.equal(deletes, 0);

    await assert.rejects(
      persistUploadedEvidence(input, db, {
        ...store,
        async put(value) {
          await store.put(value);
          throw new Error("synthetic lost put response");
        },
      }),
    );
    const unknown = await intent();
    assert.equal(unknown.status, "uncertain");
    assert.equal(await reconcileEvidenceUpload(unknown.id, db, store), "uncertain");
    assert.ok(memory.values.has(unknown.blobKey));
    assert.equal(deletes, 0);

    await assert.rejects(persistUploadedEvidence(input, rejected, store));
    assert.equal((await intent()).status, "cleaned");
    assert.equal(deletes, 1);

    await assert.rejects(
      persistUploadedEvidence(input, rejected, {
        ...store,
        async delete() {
          throw new Error("synthetic storage unavailable");
        },
      }),
    );
    const pending = await intent();
    assert.equal(pending.status, "cleanup_pending");
    assert.ok(memory.values.has(pending.blobKey));
    const results = await Promise.all([
      reconcileEvidenceUpload(pending.id, db, store),
      reconcileEvidenceUpload(pending.id, db, store),
    ]);
    assert.deepEqual(results, ["cleaned", "cleaned"]);
    assert.equal(deletes, 2, "row lock prevents duplicate successful cleanup");

    await assert.rejects(
      persistUploadedEvidence(input, rejected, {
        ...store,
        async delete(path) {
          await store.delete(path);
          throw new Error("synthetic lost delete response");
        },
      }),
    );
    const lostDelete = await intent();
    assert.equal(lostDelete.status, "cleanup_pending");
    assert.ok(!memory.values.has(lostDelete.blobKey));
    assert.equal(await reconcileEvidenceUpload(lostDelete.id, db, store), "cleaned");

    const before = deletes;
    const protectedId = await persistUploadedEvidence(input, db, store);
    // Even an inconsistent cleanup row must never delete a referenced blob.
    await db
      .update(evidenceUploadIntent)
      .set({ status: "cleanup_pending" })
      .where(eq(evidenceUploadIntent.id, protectedId));
    assert.equal(await reconcileEvidenceUpload(protectedId, db, store), "attached");
    assert.equal(deletes, before);

    const delayedId = await persistUploadedEvidence(input, db, {
      ...store,
      async put(value) {
        const saved = await store.put(value);
        assert.equal(await reconcileEvidenceUpload(value.evidenceId, db, store), "uncertain");
        return saved;
      },
    });
    assert.equal((await intent(delayedId)).status, "attached");
    assert.equal(deletes, before, "maintenance cannot delete an in-flight upload");
    console.log(
      "PASS durable upload intents, lost put/delete responses, real constraint rollback, concurrent cleanup and referenced/in-flight retention",
    );
  } finally {
    for (const id of ids) {
      await db.delete(evidence).where(eq(evidence.id, id));
      await db.delete(evidenceUploadIntent).where(eq(evidenceUploadIntent.id, id));
    }
  }
}
