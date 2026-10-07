import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import ready from "../data/fixtures/product-ready.synthetic.json";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";

const connection = process.env.CONTENT_AGENT_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";

const [owner, editor, viewer, outsider] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const [project, foreignProject, salesProject] = [randomUUID(), randomUUID(), randomUUID()];
const [product, foreignProduct, unlinkedProduct] = [randomUUID(), randomUUID(), randomUUID()];
let actor: string | null = editor;
let role = "user";
let configurations = 0;
const modelRequests: Array<{
  verifiedFacts: Array<{ field: string; value: string; evidenceRef: string }>;
}> = [];
let generationEffect: (() => Promise<void>) | undefined;
const moduleUrl = (relative: string) => new URL(relative, import.meta.url).href;

// Replace session transport and model execution only. The real Action boundary, Zod schema,
// project authorization, product query and PostgreSQL records remain in the path under test.
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module(moduleUrl("../lib/auth.ts"), {
  exports: {
    auth: { api: { getSession: async () => (actor ? { user: { id: actor, role } } : null) } },
  },
});
mock.module(moduleUrl("../lib/ai/product-agent-model-config.ts"), {
  exports: {
    resolveProductAgentModelConfig: async () => {
      configurations++;
      return {};
    },
  },
});
mock.module(moduleUrl("../lib/ai/model-provider.ts"), {
  exports: { createProductAgentModel: () => ({ provider: "synthetic-only" }) },
});
mock.module(moduleUrl("../lib/content/generation.ts"), {
  exports: {
    generateMarketingContent: async (input: (typeof modelRequests)[number]) => {
      modelRequests.push(input);
      await generationEffect?.();
      return {
        hook: input.verifiedFacts.map((fact) => fact.value).join(" "),
        body: "MOCK test-only marketing copy",
        callToAction: "Discuss MOCK workflow",
        hashtags: ["#MockTest"],
        visualInstruction: "MOCK text card",
      };
    },
  },
});
const { generateContentDraftAction } = await import("../lib/actions/content-agent.ts");

function request(overrides: Record<string, string | undefined> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    projectId: project,
    productId: product,
    contentType: "product",
    factPath: "product.product_name",
    objective: "MOCK scope verification",
    targetCustomer: "MOCK test-only buyer",
    ...overrides,
  }))
    if (value !== undefined) data.set(key, value);
  return data;
}
async function deny(input: FormData, message: RegExp) {
  const before = { configurations, requests: modelRequests.length };
  const result = await generateContentDraftAction({ status: "idle", message: "" }, input);
  assert.equal(result.status, "error");
  assert.match(result.message, message);
  assert.equal(result.draft, undefined);
  assert.deepEqual(
    { configurations, requests: modelRequests.length },
    before,
    "denied input must never resolve credentials or request a model",
  );
}

try {
  const db = getDatabase();
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  for (const id of [owner, editor, viewer, outsider])
    await db
      .insert(schema.user)
      .values({ id, name: "MOCK content scope", email: `${id}@example.invalid`, role: "user" });
  for (const [id, kind] of [
    [project, "marketing"],
    [foreignProject, "marketing"],
    [salesProject, "sales"],
  ] as const)
    await db
      .insert(schema.workspaceProject)
      .values({ id, title: "MOCK content scope", kind, createdById: owner });
  for (const [projectId, userId, memberRole] of [
    [project, owner, "owner"],
    [project, editor, "editor"],
    [project, viewer, "viewer"],
    [foreignProject, owner, "owner"],
    [salesProject, editor, "editor"],
  ] as const)
    await db
      .insert(schema.workspaceProjectMember)
      .values({ id: randomUUID(), projectId, userId, role: memberRole, createdById: owner });
  for (const id of [product, foreignProduct, unlinkedProduct])
    await db.insert(schema.aggregateRecord).values({
      id,
      type: "product",
      state: "PRODUCT_READY",
      payload: {
        ...ready,
        record_id: id,
        product: {
          ...ready.product,
          product_name:
            id === foreignProduct ? "MOCK forbidden foreign product" : "MOCK allowed scope product",
        },
      },
      createdByType: "human",
      createdById: owner,
    });
  for (const [projectId, aggregateId] of [
    [project, product],
    [foreignProject, foreignProduct],
  ])
    await db.insert(schema.workspaceProjectItem).values({
      id: randomUUID(),
      projectId,
      aggregateId,
      role: "product_source",
      relation: "owned",
    });

  // Previously this ordinary editor could omit projectId and send another project's facts to AI.
  await deny(request({ projectId: undefined, productId: foreignProduct }), /项目/);
  await deny(request({ projectId: "", productId: foreignProduct }), /项目/);
  await deny(request({ projectId: "not-a-project", productId: foreignProduct }), /项目/);
  await deny(request({ productId: foreignProduct }), /已核验/);
  await deny(request({ productId: unlinkedProduct }), /已核验/);
  await deny(request({ projectId: foreignProject, productId: foreignProduct }), /权限/);
  await deny(request({ projectId: salesProject }), /营销项目/);
  await deny(request({ factPath: "specifications.missing_fact" }), /已核验/);
  actor = viewer;
  await deny(request(), /权限/);
  actor = outsider;
  await deny(request(), /权限/);
  actor = null;
  await deny(request(), /无权/);
  actor = editor;
  role = "guest";
  await deny(request(), /无权/);
  role = "user";
  await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, editor));
  await deny(request(), /不可用/);
  await db.update(schema.user).set({ banned: false }).where(eq(schema.user.id, editor));
  await db
    .update(schema.workspaceProject)
    .set({ status: "archived" })
    .where(eq(schema.workspaceProject.id, project));
  await deny(request(), /归档/);
  await db
    .update(schema.workspaceProject)
    .set({ status: "active" })
    .where(eq(schema.workspaceProject.id, project));
  await db
    .update(schema.aggregateRecord)
    .set({ state: "PRODUCT_REVIEW_REQUIRED" })
    .where(eq(schema.aggregateRecord.id, product));
  await deny(request(), /已核验/);
  await db
    .update(schema.aggregateRecord)
    .set({ state: "PRODUCT_READY" })
    .where(eq(schema.aggregateRecord.id, product));

  for (const id of [owner, editor]) {
    actor = id;
    const result = await generateContentDraftAction({ status: "idle", message: "" }, request());
    assert.equal(result.status, "success");
    assert.equal(result.draft?.hook, "MOCK allowed scope product");
  }
  assert.equal(configurations, 2);
  assert.equal(modelRequests.length, 2);
  actor = editor;
  async function discard(effect: () => Promise<void>, message: RegExp) {
    const before = modelRequests.length;
    generationEffect = effect;
    const result = await generateContentDraftAction({ status: "idle", message: "" }, request());
    generationEffect = undefined;
    assert.equal(modelRequests.length, before + 1, "the request was initially authorized");
    assert.equal(result.status, "error");
    assert.match(result.message, message);
    assert.equal(result.draft, undefined, "revoked or stale protected drafts must not be returned");
  }
  await discard(async () => {
    actor = null;
  }, /权限/);
  actor = editor;
  await discard(async () => {
    await db
      .delete(schema.workspaceProjectMember)
      .where(eq(schema.workspaceProjectMember.userId, editor));
  }, /权限/);
  await db.insert(schema.workspaceProjectMember).values({
    id: randomUUID(),
    projectId: project,
    userId: editor,
    role: "editor",
    createdById: owner,
  });
  await discard(async () => {
    await db
      .update(schema.workspaceProject)
      .set({ status: "archived" })
      .where(eq(schema.workspaceProject.id, project));
  }, /归档/);
  await db
    .update(schema.workspaceProject)
    .set({ status: "active" })
    .where(eq(schema.workspaceProject.id, project));
  await discard(async () => {
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, editor));
  }, /不可用/);
  await db.update(schema.user).set({ banned: false }).where(eq(schema.user.id, editor));
  await discard(async () => {
    await db
      .update(schema.aggregateRecord)
      .set({ state: "PRODUCT_REVIEW_REQUIRED" })
      .where(eq(schema.aggregateRecord.id, product));
  }, /已核验/);
  await db
    .update(schema.aggregateRecord)
    .set({ state: "PRODUCT_READY" })
    .where(eq(schema.aggregateRecord.id, product));
  await discard(async () => {
    await db
      .update(schema.aggregateRecord)
      .set({
        payload: {
          ...ready,
          record_id: product,
          product: { ...ready.product, product_name: "MOCK changed after start" },
        },
      })
      .where(eq(schema.aggregateRecord.id, product));
  }, /事实已更新/);
  assert.equal(configurations, 8);
  assert.equal(modelRequests.length, 8);
  assert.ok(
    modelRequests.every(
      (input) =>
        input.verifiedFacts.length === 1 &&
        input.verifiedFacts[0].value === "MOCK allowed scope product",
    ),
  );
  console.log(
    "PASS content generation project scope: missing/empty project, foreign/unlinked product, role/membership/archive/Ready gates reject before credentials/model; owner/editor receive authorized facts; in-flight session/membership/archive/ban/Ready/fact changes discard results",
  );
} finally {
  await closeDatabase();
  mock.restoreAll();
}
