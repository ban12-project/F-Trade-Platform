import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import readyProduct from "../../data/fixtures/product-ready.synthetic.json";
import type { Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { decideQuotation } from "../../lib/sales/closing-store";
import { decryptSocialMessageBody } from "../../lib/social/message-crypto";
import { createStoredSocialMessageRecord } from "../../lib/social/message-record";
import { authSecret, databaseURL, socialMessageKey } from "../../playwright.database.config";

process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = socialMessageKey;
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
    sha256: createHash("sha256").update(evidenceId).digest("hex"),
    sizeBytes: 0,
    sourceLabel: "MOCK evidence — synthetic test only",
    uploadedByType: "human",
    uploadedById: actorId,
  });
});

test.afterAll(async () => {
  await pool.end();
});

test("mock RFQ proceeds through quotation, delivery, follow-up and opportunity", async ({
  page,
  context,
  baseURL,
  browser,
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
    ["报价依据", evidenceId],
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
  const staleContext = await browser.newContext({ baseURL });
  await staleContext.addCookies(await context.cookies());
  const stalePage = await staleContext.newPage();
  await stalePage.goto(`/workspace/${projectId}?panel=quotation`);
  const staleDecision = stalePage.locator(`form#quote-decision-${draft.id}`);
  await staleDecision.getByRole("combobox").click();
  await stalePage.getByRole("option", { name: "批准人工报价", exact: true }).click();
  await staleDecision.getByLabel("审核证据", { exact: true }).fill(evidenceId);
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
  await revision.getByLabel("报价依据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "提交修订并再次送审", exact: true }).click();
  await expect
    .poll(async () => (await records("quotation"))[0].state)
    .toBe("QUOTE_REVIEW_REQUIRED");
  const [revisedQuote] = await records("quotation");
  const approvalQuery = () =>
    db.select().from(schema.approval).where(eq(schema.approval.aggregateId, draft.id));
  const auditQuery = () =>
    db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, draft.id));
  const eventQuery = () =>
    db.select().from(schema.workflowEvent).where(eq(schema.workflowEvent.aggregateId, draft.id));
  const beforeApprovals = await approvalQuery();
  const beforeAudits = await auditQuery();
  const beforeEvents = await eventQuery();
  const oldApproval = beforeApprovals.find((item) => item.status === "rejected");
  const activeApproval = beforeApprovals.find((item) => item.status === "pending");
  if (!oldApproval || !activeApproval)
    throw new Error("Expected rejected and pending synthetic approvals");
  expect(revisedQuote.version).toBe(3);
  await expect(
    decideQuotation(
      {
        projectId,
        quotationId: draft.id,
        reviewedVersion: String(revisedQuote.version),
        approvalId: oldApproval.id,
        decision: "approved",
        evidenceRef: evidenceId,
        notes: "MOCK wrong request",
      },
      actorId,
      db as unknown as Database,
    ),
  ).rejects.toThrow("审核请求已更新");
  await stalePage.getByRole("button", { name: "批准人工报价", exact: true }).click();
  await expect(stalePage.getByText(/报价已更新|审核请求已更新/)).toBeVisible();
  expect((await records("quotation"))[0]).toEqual(revisedQuote);
  expect(await approvalQuery()).toEqual(beforeApprovals);
  expect(await auditQuery()).toEqual(beforeAudits);
  expect(await eventQuery()).toEqual(beforeEvents);
  await staleContext.close();
  await decision.getByRole("combobox").click();
  await page.getByRole("option", { name: "批准人工报价", exact: true }).click();
  await decision.getByLabel("审核证据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "批准人工报价", exact: true }).click();
  await expect.poll(async () => (await records("quotation"))[0].state).toBe("QUOTE_APPROVED");
  const [approved] = await records("quotation");
  expect(approved.version).toBe(4);
  expect(approved.payload.approval_ref).toBe(activeApproval.id);
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
  const events = await db
    .select()
    .from(schema.workflowEvent)
    .where(eq(schema.workflowEvent.aggregateId, draft.id));
  expect(events).toHaveLength(4);
  expect(events.every((event) => event.evidenceRefs.includes(evidenceId))).toBe(true);
  expect(audits.every((item) => item.actorId === actorId)).toBe(true);
  await page.reload();
  await expect(page.locator(`form#quote-send-${draft.id}`)).toBeVisible();
  // Approval alone is not delivery. A simulated receipt is registered below.
  expect((await records("quotation"))[0].state).toBe("QUOTE_APPROVED");
  const conversationId = randomUUID();
  const channelRef = `synthetic-channel-${projectId}`;
  const accountRef = `synthetic-account-${projectId}`;
  const send = page.locator(`form#quote-send-${draft.id}`);
  await send.getByLabel("发送渠道", { exact: true }).fill(channelRef);
  await send.getByLabel("外部发送凭证", { exact: true }).fill(conversationId);
  await page.locator(`button[form="quote-send-${draft.id}"]`).click();
  await expect.poll(async () => (await records("quotation"))[0].state).toBe("QUOTE_SENT");
  await expect.poll(async () => (await records("lead")).length).toBe(1);
  const [lead] = await records("lead");
  expect(lead.state).toBe("FOLLOW_UP");
  expect(lead.payload.score_band).toBe("COLD");
  expect(lead.payload.quotation_ref).toBe(draft.id);
  // Simulated external inbound boundary only; business writes below remain real UI actions.
  await db.insert(schema.socialConversation).values({
    id: conversationId,
    channelRef,
    accountRef,
    externalConversationRef: `mock-${conversationId}`,
    leadId: lead.id,
    lastMessageAt: new Date(),
  });
  await db.insert(schema.socialChannelControl).values({
    id: randomUUID(),
    channelRef,
    accountRef,
    enabled: true,
    circuitStatus: "active",
    changedBy: actorId,
    changedAt: new Date(),
  });
  await db.insert(schema.socialMessage).values(
    createStoredSocialMessageRecord({
      id: randomUUID(),
      conversationId,
      externalMessageRef: `mock-inbound-${conversationId}`,
      direction: "inbound",
      identityQuality: "manual",
      receivedAt: new Date(),
      body: "MOCK buyer: please confirm lead time and payment terms for 25 SYN-OE-001 kits. Synthetic test only.",
    }),
  );
  await page.goto(`/workspace/${projectId}?panel=follow-up`);
  await expect(page.getByRole("button", { name: "确认有效商机", exact: true })).toBeDisabled();
  const follow = page.locator(`form#follow-up-${lead.id}`);
  await follow.getByRole("combobox").click();
  await page.getByRole("option", { name: "询问交期", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "人工确认并发送此回复", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("请求证据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "创建 Gate 03 请求", exact: true }).click();
  await expect.poll(async () => (await records("delivery_confirmation")).length).toBe(1);
  const [delivery] = await records("delivery_confirmation");
  await page.goto(`/workspace/${projectId}?panel=delivery`);
  const deliveryForm = page.locator(`form#delivery-${delivery.id}`);
  await deliveryForm.getByRole("combobox").click();
  await page.getByRole("option", { name: "确认交期", exact: true }).click();
  await deliveryForm.getByLabel("确认交期（天）", { exact: true }).fill("21");
  await deliveryForm.getByLabel("审核证据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "确认人工交期", exact: true }).click();
  await expect
    .poll(async () => (await records("delivery_confirmation"))[0].state)
    .toBe("DELIVERY_CONFIRMATION_CONFIRMED");
  await page.goto(`/workspace/${projectId}?panel=follow-up`);
  await follow.getByRole("combobox").click();
  await page.getByRole("option", { name: "询问交期", exact: true }).click();
  for (const label of ["提供 OE", "明确数量", "询问交期", "询问付款条件"]) {
    await follow.getByRole("checkbox", { name: label, exact: true }).check();
  }
  await follow
    .getByLabel("待人工发送内容", { exact: true })
    .fill("MOCK reply: thank you for the inquiry. Synthetic test only.");
  await follow.getByLabel("本次人工确认凭据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "人工确认并发送此回复", exact: true }).click();
  await expect.poll(async () => (await records("lead"))[0].payload.score_band).toBe("HOT");
  const [job] = await db
    .select()
    .from(schema.socialBrowserJob)
    .where(eq(schema.socialBrowserJob.channelRef, channelRef));
  expect(job.status).toBe("queued");
  expect(job.kind).toBe("reply");
  const [outbound] = await db
    .select()
    .from(schema.socialMessage)
    .where(eq(schema.socialMessage.id, job.payloadRef));
  expect(outbound.direction).toBe("outbound");
  const reply = decryptSocialMessageBody(outbound.bodyCiphertext);
  expect(reply).toContain("MOCK reply");
  expect(reply).toContain("21");
  expect(outbound.bodyCiphertext).not.toContain("MOCK reply");
  await page.getByLabel("商机确认凭据", { exact: true }).fill(evidenceId);
  await page.getByRole("button", { name: "确认有效商机", exact: true }).click();
  await expect.poll(async () => (await records("lead"))[0].state).toBe("OPPORTUNITY");
  const leadAudits = await db
    .select()
    .from(schema.auditEvent)
    .where(eq(schema.auditEvent.aggregateId, lead.id));
  expect(leadAudits.map((item) => item.action)).toContain("lead.opportunity_confirmed");
  expect(
    (
      await db.select().from(schema.socialBrowserJob).where(eq(schema.socialBrowserJob.id, job.id))
    )[0].status,
  ).toBe("queued");
  // No worker is connected: queued is not delivered, and all confirmations are simulated.
});
