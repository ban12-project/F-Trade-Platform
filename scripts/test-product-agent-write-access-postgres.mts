import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MockLanguageModelV3 } from "ai/test";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { ProductAgentAccessError } from "../lib/product/intake-errors";
import type { ProductDraft } from "../lib/product/verification";

const connection = process.env.PRODUCT_AGENT_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw new Error("Remote requests forbidden in synthetic product write tests");
};
const db = getDatabase();
let sessionId = "",
  generatedId = "";
let duringGeneration: (() => Promise<void>) | undefined;
let duringConfiguration: (() => Promise<void>) | undefined;
let modelCalls = 0,
  configurationCalls = 0;
let inventedFact = false;
type SessionSnapshot = {
  user: typeof schema.user.$inferSelect;
  session: typeof schema.session.$inferSelect;
};
let cachedSession: SessionSnapshot | undefined;
const deniedMessage = "无法确认登录或项目编辑权限，产品草稿未创建。请重新登录并确认权限后重试。";
const moduleUrl = (relative: string) => new URL(relative, import.meta.url).href;

async function readSession() {
  const [row] = await db
    .select()
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
    .where(eq(schema.session.id, sessionId));
  if (!row || row.user.banned || row.session.expiresAt <= new Date()) return null;
  return row;
}
// Only Next request/cache transport and external model configuration/execution are
// controlled. Actual Action authz, SDK, evidence validation, domain writes and DB run.
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", { exports: { revalidatePath: () => {} } });
mock.module(moduleUrl("../lib/auth.ts"), {
  exports: { auth: { api: { getSession: async () => cachedSession ?? readSession() } } },
});
mock.module(moduleUrl("../lib/ai/product-agent-model-config.ts"), {
  exports: {
    resolveProductAgentModelConfig: async () => {
      configurationCalls++;
      await duringConfiguration?.();
      return {};
    },
  },
});
const model = new MockLanguageModelV3({
  doGenerate: async ({ prompt }) => {
    modelCalls++;
    const userMessage = prompt.find((message) => message.role === "user");
    assert(userMessage?.role === "user");
    const text = userMessage.content.find((part) => part.type === "text");
    assert(text?.type === "text");
    const source = JSON.parse(text.text) as {
      record_id: string;
      source_ref: string;
      source_text: string;
      evidence_refs: string[];
    };
    generatedId = source.record_id;
    const ref = (label: string) => {
      const location = [
        ...source.source_text.matchAll(
          /<evidence-location ref="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/evidence-location>/g,
        ),
      ].find((item) => item[2]?.includes(label));
      assert(location?.[1]);
      return location[1];
    };
    const draft = {
      record_id: source.record_id,
      source_ref: source.source_ref,
      evidence_refs: source.evidence_refs,
      field_evidence: {
        "product.product_name": ref("Product name:"),
        "product.product_type": ref("Product type:"),
        "product.internal_sku": ref("Internal SKU:"),
      },
      verification_status: "review_required",
      blocking_missing_fields: [],
      optional_missing_fields: [],
      product: {
        product_name: inventedFact ? "SYNTHETIC invented product" : "SYNTHETIC write guard product",
        product_type: "clutch_kit",
        internal_sku: "SYN-WRITE-GUARD",
      },
    };
    await duringGeneration?.();
    return {
      content: [{ type: "text", text: JSON.stringify(draft) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    };
  },
});
mock.module(moduleUrl("../lib/ai/model-provider.ts"), {
  exports: { createProductAgentModel: () => model },
});
const { runProductAgentAction } = await import("../lib/actions/product-agent.ts");
const { createProductAgentDraft } = await import("../lib/products.ts");

async function fixture(role = "user", ttlMs = 3_600_000) {
  const actorId = randomUUID(),
    ownerId = randomUUID(),
    projectId = randomUUID(),
    sid = randomUUID();
  const evidenceRef = `evidence-synthetic-write-${randomUUID()}`;
  await db.insert(schema.user).values([
    { id: actorId, name: "SYNTHETIC write guard", email: `${actorId}@example.invalid`, role },
    {
      id: ownerId,
      name: "SYNTHETIC write guard owner",
      email: `${ownerId}@example.invalid`,
      role: "user",
    },
  ]);
  await db.insert(schema.session).values({
    id: sid,
    userId: actorId,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    title: "SYNTHETIC write guard",
    kind: "marketing",
    createdById: ownerId,
  });
  for (const [userId, memberRole] of [
    [ownerId, "owner"],
    [actorId, "editor"],
  ] as const)
    await db
      .insert(schema.workspaceProjectMember)
      .values({ id: randomUUID(), projectId, userId, role: memberRole, createdById: ownerId });
  await db.insert(schema.evidence).values({
    id: evidenceRef,
    classification: "internal",
    blobKey: `synthetic/${evidenceRef}`,
    contentType: "text/plain",
    sizeBytes: 1,
    sha256: createHash("sha256").update(evidenceRef).digest("hex"),
    sourceLabel: "SYNTHETIC write guard",
    uploadedByType: "human",
    uploadedById: actorId,
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({
    projectId,
    modelConfigId: "synthetic-model",
    model: "synthetic-model",
    sourceRef: `source-synthetic-${randomUUID()}`,
    evidenceRef,
    sourceText:
      "Product name: SYNTHETIC write guard product\nProduct type: clutch_kit\nInternal SKU: SYN-WRITE-GUARD",
  }))
    form.set(key, value);
  sessionId = sid;
  cachedSession = undefined;
  return { actorId, ownerId, projectId, sid, form };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const run = (f: Fixture) => runProductAgentAction({ status: "idle", message: "" }, f.form);
async function productWrites(id: string) {
  const rows = await Promise.all([
    db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, id)),
    db
      .select()
      .from(schema.workspaceProjectItem)
      .where(eq(schema.workspaceProjectItem.aggregateId, id)),
    db.select().from(schema.productSourceImage).where(eq(schema.productSourceImage.productId, id)),
    db.select().from(schema.approval).where(eq(schema.approval.aggregateId, id)),
    db.select().from(schema.workflowEvent).where(eq(schema.workflowEvent.aggregateId, id)),
    db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, id)),
  ]);
  return rows.map((records) => records.length);
}
async function assertDenied(result: Awaited<ReturnType<typeof run>>, id: string) {
  assert.deepEqual(result, { status: "error", message: deniedMessage });
  assert.deepEqual(
    await productWrites(id),
    [0, 0, 0, 0, 0, 0],
    "No product, project/image link, Gate, workflow or audit write",
  );
}
async function assertSuccess(result: Awaited<ReturnType<typeof run>>) {
  assert.equal(result.status, "success");
  assert.equal(result.productId, generatedId);
  assert.deepEqual(await productWrites(generatedId), [1, 1, 0, 1, 1, 1]);
  const [record] = await db
    .select()
    .from(schema.aggregateRecord)
    .where(eq(schema.aggregateRecord.id, generatedId));
  assert.equal(record.state, "PRODUCT_REVIEW_REQUIRED");
  const draft = record.payload as unknown as ProductDraft;
  assert.equal(draft.verification_status, "review_required");
  assert(Object.values(draft.field_evidence).every((ref) => ref.startsWith("evidence-loc-line-")));
  const [gate] = await db
    .select()
    .from(schema.approval)
    .where(eq(schema.approval.aggregateId, generatedId));
  assert.equal(gate.status, "pending");
  assert.equal(gate.gate, "gate_01_truth");
  return draft;
}

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const ordinary = await fixture();
  const validDraft = await assertSuccess(await run(ordinary));
  const admin = await fixture("admin");
  await assertSuccess(await run(admin));
  const demoted = await fixture("admin");
  duringGeneration = async () => {
    await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, demoted.actorId));
  };
  await assertSuccess(await run(demoted));
  duringGeneration = undefined;
  console.log(
    "PASS actual single-product Action/SDK/evidence guards: ordinary user, admin and admin-to-user remain review-only",
  );

  const changes: Array<[string, (f: Fixture) => Promise<unknown>]> = [
    ["session revoked", (f) => db.delete(schema.session).where(eq(schema.session.id, f.sid))],
    [
      "account banned",
      (f) => db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId)),
    ],
    [
      "product role removed",
      (f) => db.update(schema.user).set({ role: "guest" }).where(eq(schema.user.id, f.actorId)),
    ],
    [
      "session expired",
      (f) =>
        db
          .update(schema.session)
          .set({ expiresAt: new Date(Date.now() - 1) })
          .where(eq(schema.session.id, f.sid)),
    ],
    [
      "member demoted",
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
      "membership removed",
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
    [
      "project archived",
      (f) =>
        db
          .update(schema.workspaceProject)
          .set({ status: "archived" })
          .where(eq(schema.workspaceProject.id, f.projectId)),
    ],
    [
      "project kind changed",
      (f) =>
        db
          .update(schema.workspaceProject)
          .set({ kind: "sales" })
          .where(eq(schema.workspaceProject.id, f.projectId)),
    ],
  ];
  for (const [label, change] of changes) {
    const f = await fixture();
    duringGeneration = async () => {
      await change(f);
    };
    const before = modelCalls;
    await assertDenied(await run(f), generatedId);
    assert.equal(modelCalls, before + 1);
    duringGeneration = undefined;
    console.log(
      `PASS in-flight ${label}: fixed denial and zero product/link/Gate/workflow/audit writes`,
    );
  }

  // Even a previously valid session transport snapshot cannot bypass DB preflight.
  for (const [label, change] of changes) {
    const f = await fixture();
    const snapshot = await readSession();
    assert(snapshot);
    cachedSession = snapshot;
    await change(f);
    const before = [configurationCalls, modelCalls];
    const result = await run(f);
    assert.deepEqual(result, { status: "error", message: deniedMessage });
    assert.deepEqual([configurationCalls, modelCalls], before);
    const gates = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.requestedById, f.actorId));
    const audits = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.action, "product_agent_draft_created"),
          sql`${schema.auditEvent.metadata} ->> 'requested_by' = ${f.actorId}`,
        ),
      );
    assert.equal(gates.length, 0);
    assert.equal(audits.length, 0);
    cachedSession = undefined;
    console.log(`PASS preflight ${label} rejects stale transport before credentials or model`);
  }
  for (const [label, change] of changes.slice(0, 3)) {
    const f = await fixture(),
      before = modelCalls;
    duringConfiguration = async () => {
      await change(f);
    };
    try {
      assert.deepEqual(await run(f), { status: "error", message: deniedMessage });
      assert.equal(
        modelCalls,
        before,
        "Revocation during configuration prevents forwarding source to a model",
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.approval)
            .where(eq(schema.approval.requestedById, f.actorId))
        ).length,
        0,
      );
      console.log(`PASS ${label} during model configuration: zero model calls or Gate creation`);
    } finally {
      duringConfiguration = undefined;
    }
  }
  for (const value of [undefined, "", "not-a-project", randomUUID()]) {
    const f = await fixture();
    if (value === undefined) f.form.delete("projectId");
    else f.form.set("projectId", value);
    const before = [configurationCalls, modelCalls];
    assert.equal((await run(f)).status, "error");
    assert.deepEqual([configurationCalls, modelCalls], before);
  }
  console.log("PASS missing, empty, invalid and foreign project rejects before credentials/model");

  const identity = {
    actorId: ordinary.ownerId,
    sessionId: ordinary.sid,
    projectId: ordinary.projectId,
  };
  const directId = randomUUID();
  await assert.rejects(
    createProductAgentDraft({ ...validDraft, record_id: directId }, identity, {}),
    ProductAgentAccessError,
  );
  await assert.rejects(
    createProductAgentDraft(
      { ...validDraft, record_id: directId },
      { ...identity, actorId: "" },
      {},
    ),
    ProductAgentAccessError,
  );
  assert.deepEqual(await productWrites(directId), [0, 0, 0, 0, 0, 0]);
  console.log(
    "PASS direct persistence requires the exact current session owner and valid identity",
  );

  const unbacked = await fixture();
  inventedFact = true;
  const unbackedResult = await run(unbacked);
  inventedFact = false;
  assert.equal(unbackedResult.status, "error");
  assert.equal(unbackedResult.productId, undefined);
  assert.deepEqual(await productWrites(generatedId), [0, 0, 0, 0, 0, 0]);
  console.log(
    "PASS invented model fact is still rejected by actual SDK/source validation without persistence",
  );

  // Control Date only: real model boundary, locks, transactions and waits still run.
  const clockStart = Date.now();
  mock.timers.enable({ apis: ["Date"], now: clockStart });
  try {
    for (const row of ["user", "workspace_project"] as const) {
      mock.timers.setTime(clockStart);
      const f = await fixture("user", 60_000);
      const lockPool = new Pool({ connectionString: connection });
      const blocker = await lockPool.connect();
      let pending: ReturnType<typeof run> | undefined;
      let signal!: () => void;
      const acquired = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const {
        rows: [backend],
      } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      duringGeneration = async () => {
        await blocker.query("BEGIN");
        if (row === "user")
          await blocker.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [f.actorId]);
        else
          await blocker.query("SELECT id FROM workspace_project WHERE id = $1 FOR UPDATE", [
            f.projectId,
          ]);
        signal();
      };
      try {
        pending = run(f);
        await Promise.race([
          acquired,
          delay(5_000).then(() => {
            throw new Error("Model boundary did not acquire the controlled lock");
          }),
        ]);
        const deadline = performance.now() + 5_000;
        let observed = false;
        do {
          const {
            rows: [result],
          } = await lockPool.query<{ blocked: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
            [backend.pid],
          );
          observed = result.blocked;
          if (observed) break;
          await delay(10);
        } while (performance.now() < deadline);
        assert(observed, "Observe actual persistence lock wait before advancing session expiry");
        mock.timers.setTime(clockStart + 60_000);
        await blocker.query("COMMIT");
        await assertDenied(await pending, generatedId);
        console.log(
          `PASS natural session expiry after observed ${row} lock wait: zero product/link/Gate/workflow/audit writes`,
        );
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        duringGeneration = undefined;
        try {
          await pending;
        } finally {
          await lockPool.end();
        }
      }
    }
  } finally {
    mock.timers.reset();
  }
  console.log(
    "PASS synthetic single-product current authorization and review-only persistence; no remote requests; append-only audits retained",
  );
} finally {
  await closeDatabase();
  mock.restoreAll();
}
