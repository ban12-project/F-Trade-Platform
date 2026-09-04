import assert from "node:assert/strict";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "../lib/db/client";
import { listWorkspacePipeline, listWorkspaceTasks } from "../lib/workspace/store";

type Row = Record<string, unknown>;
const projectId = "00000000-0000-4000-8000-000000000263";
const actorId = "synthetic-authorized-member";
const dialect = new PgDialect();
class Query implements PromiseLike<Row[]> {
  table = "";
  params: unknown[] = [];
  constructor(private store: FakeDatabase) {}
  from(table: Table) {
    this.table = getTableName(table);
    return this;
  }
  innerJoin(..._args: unknown[]) {
    return this;
  }
  where(condition: SQL | undefined) {
    this.params = condition ? dialect.sqlToQuery(condition).params : [];
    return this;
  }
  orderBy(..._args: unknown[]) {
    return this;
  }
  limit(_count: number) {
    return this;
  }
  then<A = Row[], B = never>(
    resolve?: ((rows: Row[]) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.store.execute(this).then(resolve, reject);
  }
}
class FakeDatabase {
  queries: Query[] = [];
  active = 0;
  maximum = 0;
  constructor(private visible = true) {}
  select(_columns: unknown) {
    return new Query(this);
  }
  async execute(query: Query): Promise<Row[]> {
    this.queries.push(query);
    this.active++;
    this.maximum = Math.max(this.maximum, this.active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.active--;
    if (query.table === "workspace_project_member") return this.visible ? [{ id: projectId }] : [];
    if (query.table === "workspace_project")
      return [
        {
          id: projectId,
          title: "Synthetic project",
          kind: "marketing",
          status: "active",
          updatedAt: new Date("2026-09-04T00:00:00Z"),
        },
      ];
    return [];
  }
  asDatabase() {
    return this as unknown as Database;
  }
}
async function main() {
  const scoped = new FakeDatabase();
  assert.deepEqual(await listWorkspaceTasks(actorId, scoped.asDatabase(), projectId), []);
  assert.equal(
    scoped.maximum,
    4,
    "Independent review, RFQ, lead, and publication queries must overlap",
  );
  assert.equal(scoped.queries.length, 5, "One membership query and four independent task reads");
  assert.ok(scoped.queries[0]?.params.includes(actorId), "Membership must be filtered by actor");
  assert.ok(
    scoped.queries[0]?.params.includes(projectId),
    "Project pages must scope the membership read",
  );
  for (const query of scoped.queries.slice(1))
    assert.ok(
      query.params.includes(projectId),
      "Every task query must retain the authorized project filter",
    );
  const denied = new FakeDatabase(false);
  assert.deepEqual(await listWorkspaceTasks(actorId, denied.asDatabase(), projectId), []);
  assert.equal(
    denied.queries.length,
    1,
    "No business records may be read without visible membership",
  );
  const all = new FakeDatabase();
  await listWorkspaceTasks(actorId, all.asDatabase());
  assert.ok(all.queries[0]?.params.includes(actorId));
  assert.ok(!all.queries[0]?.params.includes(projectId));
  const pipeline = new FakeDatabase();
  await listWorkspacePipeline(actorId, pipeline.asDatabase());
  assert.equal(pipeline.maximum, 2, "Pipeline records and published outcomes must overlap");
  console.log(
    "PASS deterministic query concurrency: tasks 4-way, pipeline 2-way; project and actor authorization filters retained",
  );
}
void main();
