import assert from "node:assert/strict";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "../lib/db/client";
import { persistProductStreamDraft } from "../lib/product/stream-store";
import type { ProductDraft } from "../lib/product/verification";

const identity = {
  actorId: "synthetic-admin",
  sessionId: "synthetic-session",
  projectId: "synthetic-project",
};
const draft: ProductDraft = {
  record_id: "synthetic-product",
  source_ref: "source-synthetic",
  evidence_refs: [],
  field_evidence: {},
  product: {},
  verification_status: "review_required",
  blocking_missing_fields: [],
  optional_missing_fields: [],
};
const dialect = new PgDialect();
async function verify() {
  for (const mode of [
    "allowed",
    "revoked",
    "membership",
    "expired",
    "completed",
    "wrong-session",
    "ready",
    "overwrite",
  ] as const) {
    const writes: Record<string, unknown>[] = [];
    const locks: string[] = [];
    const tx = {
      select() {
        let table = "";
        let params: unknown[] = [];
        const query = {
          from(value: Table) {
            table = getTableName(value);
            return query;
          },
          innerJoin() {
            return query;
          },
          where(condition: SQL) {
            params = dialect.sqlToQuery(condition).params;
            return query;
          },
          async for(lock: string) {
            locks.push(`${table}:${lock}`);
            if (table === "user") {
              assert.ok(params.includes("admin"));
              assert.ok(params.includes(false));
              assert.ok(params.includes(identity.sessionId));
              assert.ok(
                params.some(
                  (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value),
                ),
              );
              return mode === "revoked" ? [] : [{ id: identity.actorId }];
            }
            if (table === "workspace_project_member") {
              assert.ok(params.includes("marketing"));
              assert.ok(params.includes("editor"));
              return mode === "membership" ? [] : [{ id: "synthetic-membership" }];
            }
            if (table === "product_agent_stream_run")
              return [
                {
                  id: "run",
                  ...identity,
                  sessionId: mode === "wrong-session" ? "other-session" : identity.sessionId,
                  productId: draft.record_id,
                  status: mode === "completed" ? "completed" : "running",
                  expiresAt: mode === "expired" ? new Date(0) : new Date(Date.now() + 60000),
                },
              ];
            if (table === "aggregate_record")
              return [
                {
                  id: draft.record_id,
                  version: 1,
                  state: mode === "ready" ? "PRODUCT_READY" : "PRODUCT_REVIEW_REQUIRED",
                  payload:
                    mode === "overwrite"
                      ? {
                          ...draft,
                          product: { product_name: "Previously reviewed" },
                          field_evidence: { "product.product_name": "evidence-original" },
                        }
                      : draft,
                },
              ];
            throw new Error(`Unexpected table ${table}`);
          },
        };
        return query;
      },
      update() {
        return {
          set(value: Record<string, unknown>) {
            writes.push(value);
            return { async where() {} };
          },
        };
      },
      insert() {
        return {
          async values(value: Record<string, unknown>) {
            writes.push(value);
          },
        };
      },
    };
    const database = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Database;
    const write = () => persistProductStreamDraft(identity, "run", draft, database);
    if (mode === "allowed") {
      assert.deepEqual(await write(), { productId: draft.record_id, version: 2 });
      assert.equal(writes.length, 2);
      assert.deepEqual(locks, [
        "user:share",
        "workspace_project_member:share",
        "product_agent_stream_run:update",
        "aggregate_record:update",
      ]);
    } else {
      await assert.rejects(write);
      assert.deepEqual(writes, [], mode);
    }
  }
  console.log(
    "PASS stream persistence rechecks locked authorization and rejects expired, foreign, finished, Ready and overwriting writes",
  );
}
void verify();
