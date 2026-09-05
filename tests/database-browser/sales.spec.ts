import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import readyProduct from "../../data/fixtures/product-ready.synthetic.json";
import * as schema from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";

const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
const actorId = `synthetic-browser-${randomUUID()}`;
const projectId = randomUUID();
const token = randomUUID();
const evidenceId = `evidence-mock-${randomUUID()}`;
const productId = randomUUID();

test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values({
    id: actorId,
    name: "Synthetic browser reviewer",
    email: `${actorId}@example.invalid`,
    emailVerified: true,
    role: "admin",
  });
  await db.insert(schema.session).values({
    id: randomUUID(),
    token,
    userId: actorId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    title: "MOCK browser integration only",
    kind: "sales",
    createdById: actorId,
  });
  await db.insert(schema.workspaceProjectMember).values({
    id: randomUUID(),
    projectId,
    userId: actorId,
    role: "owner",
    createdById: actorId,
  });
  // Seed only the previously tested product prerequisite. All sales writes use the UI.
  await db.insert(schema.aggregateRecord).values({
    id: productId,
    type: "product",
    state: "PRODUCT_READY",
    payload: readyProduct,
    createdByType: "human",
    createdById: actorId,
  });
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId,
    aggregateId: productId,
    role: "product_reference",
    relation: "reference",
  });
  // A synthetic persisted evidence record; file upload/storage is outside this test.
  await db.insert(schema.evidence).values({
    id: evidenceId,
    classification: "internal",
    blobKey: `synthetic/mock-sales-${evidenceId}-not-a-real-blob`,
    contentType: "text/plain",
    sha256: "a".repeat(64),
    sizeBytes: 0,
    sourceLabel: "MOCK evidence — synthetic test only",
    uploadedByType: "human",
    uploadedById: actorId,
  });
});

test.afterAll(async () => {
  await pool.end();
});

test("mock RFQ completes before quotation rejection, revision and approval", async ({
  page,
  context,
  baseURL,
}) => {
  const path = `/workspace/${projectId}?panel=rfq`;
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth/);
  const signature = createHmac("sha256", authSecret).update(token).digest("base64");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${token}.${signature}`),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(path);
  const form = page.locator("form#create-rfq");
  await form.getByLabel("客户名称", { exact: true }).fill("MOCK buyer — synthetic only");
  await form.getByLabel("OE / OEM 编号", { exact: true }).fill("SYN-OE-001");
  await form.getByLabel("录入证据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "保存询盘", exact: true }).click();
  const records = (type: typeof schema.aggregateRecord.$inferSelect.type) =>
    db
      .select()
      .from(schema.aggregateRecord)
      .where(
        and(eq(schema.aggregateRecord.createdById, actorId), eq(schema.aggregateRecord.type, type)),
      );
  await expect.poll(async () => (await records("rfq")).length).toBe(1);
  const [rfq] = await records("rfq");
  expect(rfq.state).toBe("RFQ_COLLECTING");
  await page.getByRole("tab", { name: "询盘 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认 RFQ Ready", exact: true })).toBeDisabled();
  expect(await records("quotation")).toHaveLength(0);
  const revise = page.locator(`form#revise-rfq-${rfq.id}`);
  await revise.getByLabel("数量", { exact: true }).fill("25");
  await revise.getByLabel("目的地国家或港口", { exact: true }).fill("MOCK destination");
  await revise.getByLabel("录入证据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "保存补充资料", exact: true }).click();
  await expect.poll(async () => (await records("rfq"))[0].version).toBe(2);
  await page.getByLabel("完整性确认凭据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "确认 RFQ Ready", exact: true }).click();
  await expect.poll(async () => (await records("rfq"))[0].state).toBe("RFQ_READY");
  const [readyRfq] = await records("rfq");
  expect(readyRfq.payload.commercial).toMatchObject({
    quantity: 25,
    destination: "MOCK destination",
  });
  expect(readyRfq.payload.missing_fields).toEqual([]);
  await page.goto(`/workspace/${projectId}?panel=quotation`);
  const quote = page.locator("form#quotation-new");
  for (const [label, value] of [
    ["单价", "12.50"],
    ["MOQ", "10"],
    ["交期（天）", "30"],
    ["付款条件", "MOCK terms; no real offer"],
  ]) {
    await quote.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole("button", { name: "创建报价并提交 Gate 02", exact: true }).click();
  await expect.poll(async () => (await records("quotation")).length).toBe(1);
  const [draft] = await records("quotation");
  expect(draft.state).toBe("QUOTE_REVIEW_REQUIRED");
  expect(draft.payload).toMatchObject({
    rfq_id: rfq.id,
    product_id: productId,
    quote: { unit_price: 12.5, currency: "USD", moq: 10, lead_time_days: 30 },
  });
  const decision = page.locator(`form#quote-decision-${draft.id}`);
  await decision.getByRole("combobox").click();
  await page.getByRole("option", { name: "退回人工报价", exact: true }).click();
  await decision.getByLabel("审核证据", { exact: true }).fill(evidenceId);
  await decision.locator("textarea").fill("MOCK revision: adjust simulated price");
  await page.getByRole("button", { name: "退回人工报价", exact: true }).click();
  await expect
    .poll(async () => (await records("quotation"))[0].state)
    .toBe("QUOTE_REVISION_REQUIRED");
  const revision = page.locator(`form#quotation-${draft.id}`);
  await revision.getByLabel("单价", { exact: true }).fill("13.25");
  await page.getByRole("button", { name: "提交修订并再次送审", exact: true }).click();
  await expect
    .poll(async () => (await records("quotation"))[0].state)
    .toBe("QUOTE_REVIEW_REQUIRED");
  await decision.getByRole("combobox").click();
  await page.getByRole("option", { name: "批准人工报价", exact: true }).click();
  await decision.getByLabel("审核证据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "批准人工报价", exact: true }).click();
  await expect.poll(async () => (await records("quotation"))[0].state).toBe("QUOTE_APPROVED");
  const [approved] = await records("quotation");
  expect(approved.payload.quote).toEqual({ ...(draft.payload.quote as object), unit_price: 13.25 });
  const approvals = await db
    .select()
    .from(schema.approval)
    .where(eq(schema.approval.aggregateId, draft.id));
  expect(approvals.map((item) => item.status).sort()).toEqual(["approved", "rejected"]);
  expect(
    approvals.every((item) => item.decidedById === actorId && item.evidenceRef === evidenceId),
  ).toBe(true);
  expect(approved.payload.approval_ref).toBe(
    approvals.find((item) => item.status === "approved")?.id,
  );
  expect(await records("lead")).toHaveLength(0);
  const audits = await db
    .select()
    .from(schema.auditEvent)
    .where(eq(schema.auditEvent.aggregateId, draft.id));
  expect(audits).toHaveLength(4);
  expect(audits.every((item) => item.actorId === actorId)).toBe(true);
  await page.reload();
  await expect(page.locator(`form#quote-send-${draft.id}`)).toBeVisible();
  // Approval is not external delivery. No send/transport is invoked by this test.
  expect((await records("quotation"))[0].state).toBe("QUOTE_APPROVED");
});
