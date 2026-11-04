import assert from "node:assert/strict";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "../lib/db/client";
import { readHumanOpportunityIds } from "../lib/workspace/business-funnel-store";

const dialect = new PgDialect();
let queries = 0;
const database = {
  select() {
    queries++;
    return query;
  },
} as unknown as Database;
const query = {
  from() {
    return query;
  },
  innerJoin() {
    return query;
  },
  async where(condition: SQL) {
    const { sql, params } = dialect.sqlToQuery(condition);
    assert.ok(sql.includes('"workspace_project_member"."user_id"'));
    for (const value of [
      "synthetic-actor",
      "synthetic-lead",
      "owned",
      "FOLLOW_UP",
      "OPPORTUNITY",
      "human",
    ])
      assert.ok(params.includes(value), `Missing authorization/evidence filter ${value}`);
    return [
      {
        aggregateId: "synthetic-lead",
        actorId: "synthetic-human",
        evidenceRefs: ["synthetic-evidence"],
      },
      {
        aggregateId: "synthetic-lead",
        actorId: "synthetic-human",
        evidenceRefs: ["synthetic-evidence"],
      },
      { aggregateId: "missing-evidence", actorId: "synthetic-human", evidenceRefs: [] },
      { aggregateId: "empty-evidence", actorId: "synthetic-human", evidenceRefs: [""] },
      { aggregateId: "missing-human", actorId: " ", evidenceRefs: ["synthetic-evidence"] },
    ];
  },
};
async function main() {
  assert.deepEqual(await readHumanOpportunityIds("synthetic-actor", [], database), []);
  assert.equal(queries, 0, "Do not query global workflow history when there are no candidates");
  assert.deepEqual(await readHumanOpportunityIds("synthetic-actor", ["synthetic-lead"], database), [
    "synthetic-lead",
  ]);
  assert.equal(queries, 1);
  console.log(
    "PASS funnel confirmation query: actor membership, owned aggregate candidates, human event, evidence, deduplication and empty scope",
  );
}
void main();
