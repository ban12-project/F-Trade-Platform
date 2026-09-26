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
let actorId = `synthetic-browser-${randomUUID()}`;
let projectId = randomUUID();
let token = randomUUID();
let evidenceId = `evidence-mock-${randomUUID()}`;
let productId = randomUUID();

test.beforeEach(async () => {
  actorId = `synthetic-browser-${randomUUID()}`;
  projectId = randomUUID();
  token = randomUUID();
  evidenceId = `evidence-mock-${randomUUID()}`;
  productId = randomUUID();
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

for (const inbound of [false, true]) {
  test(`${inbound ? "received customer" : "manual RFQ"} proceeds through quotation, delivery, follow-up and opportunity`, async ({
    page,
    context,
    baseURL,
    browser,
  }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(20_000);
    const receivedLeadId = randomUUID();
    const conversationId = randomUUID();
    const channelRef = `synthetic-channel-${projectId}`;
    const accountRef = `synthetic-account-${projectId}`;
    if (inbound) {
      await db.insert(schema.aggregateRecord).values({
        id: receivedLeadId,
        type: "lead",
        state: "LEAD_RECEIVED",
        createdByType: "human",
        createdById: actorId,
        payload: {
          lead_id: receivedLeadId,
          conversation_ref: conversationId,
          status: "received",
          score: 0,
          score_reasons: [],
          next_action: "collect_rfq_facts",
        },
      });
      await db.insert(schema.workspaceProjectItem).values({
        id: randomUUID(),
        projectId,
        aggregateId: receivedLeadId,
        role: "sales_lead",
        relation: "owned",
      });
      await db.insert(schema.socialConversation).values({
        id: conversationId,
        channelRef,
        accountRef,
        externalConversationRef: `mock-${conversationId}`,
        leadId: receivedLeadId,
        lastMessageAt: new Date(),
      });
    }
    const path = inbound
      ? `/workspace/${projectId}/records/lead/${receivedLeadId}`
      : `/workspace/${projectId}/new/rfq`;
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
    if (inbound) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("link", { name: "整理客户需求", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "来源客户会话（可选）" })).toBeDisabled();
    }
    const form = page.locator("form#create-rfq").filter({ visible: true });
    await form.getByLabel("客户名称", { exact: true }).fill("MOCK buyer — synthetic only");
    await form.getByLabel("OE / OEM 编号", { exact: true }).fill("SYN-OE-001");
    await form.getByLabel("录入证据", { exact: true }).fill(evidenceId);
    await page.getByRole("button", { name: "保存询盘", exact: true }).click();
    const records = (type: typeof schema.aggregateRecord.$inferSelect.type) =>
      db
        .select()
        .from(schema.aggregateRecord)
        .where(
          and(
            eq(schema.aggregateRecord.createdById, actorId),
            eq(schema.aggregateRecord.type, type),
          ),
        );
    await expect.poll(async () => (await records("rfq")).length).toBe(1);
    const [rfq] = await records("rfq");
    expect(rfq.state).toBe("RFQ_COLLECTING");
    if (inbound) expect(rfq.payload.lead_ref).toBe(receivedLeadId);
    if (!inbound) await page.getByRole("link", { name: "打开客户需求", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/records/rfq/${rfq.id}$`));
    await expect(page.getByRole("button", { name: "确认需求完整", exact: true })).toBeDisabled();
    expect(await records("quotation")).toHaveLength(0);
    const revise = page.locator(`form#revise-rfq-${rfq.id}`).filter({ visible: true });
    await revise.getByLabel("数量", { exact: true }).fill("25");
    await revise.getByLabel("目的地国家或港口", { exact: true }).fill("MOCK destination");
    await revise.getByLabel("录入证据", { exact: true }).fill(evidenceId);
    await page.getByRole("button", { name: "保存补充资料", exact: true }).click();
    await expect.poll(async () => (await records("rfq"))[0].version).toBe(2);
    await page.getByLabel("完整性确认凭据", { exact: true }).fill(evidenceId);
    await page.getByRole("button", { name: "确认需求完整", exact: true }).click();
    await expect.poll(async () => (await records("rfq"))[0].state).toBe("RFQ_READY");
    const [readyRfq] = await records("rfq");
    expect(readyRfq.payload.commercial).toMatchObject({
      quantity: 25,
      destination: "MOCK destination",
    });
    expect(readyRfq.payload.missing_fields).toEqual([]);
    await page.getByRole("link", { name: "创建人工报价", exact: true }).click();
    const quote = page.locator("form#quotation-new").filter({ visible: true });
    for (const [label, value] of [
      ["单价", "12.50"],
      ["报价依据", evidenceId],
      ["MOQ", "10"],
      ["交期（天）", "30"],
      ["付款条件", "MOCK terms; no real offer"],
    ]) {
      await quote.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByRole("button", { name: "创建报价并提交审核", exact: true }).click();
    await expect.poll(async () => (await records("quotation")).length).toBe(1);
    const [draft] = await records("quotation");
    expect(draft.state).toBe("QUOTE_REVIEW_REQUIRED");
    expect(draft.payload).toMatchObject({
      rfq_id: rfq.id,
      product_id: productId,
      quote: { unit_price: 12.5, currency: "USD", moq: 10, lead_time_days: 30 },
    });
    await page.getByRole("link", { name: "打开人工报价", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/records/quotation/${draft.id}$`));
    const staleContext = await browser.newContext({ baseURL });
    await staleContext.addCookies(await context.cookies());
    const stalePage = await staleContext.newPage();
    await stalePage.goto(`/workspace/${projectId}/records/quotation/${draft.id}`);
    const staleDecision = stalePage
      .locator(`form#quote-decision-${draft.id}`)
      .filter({ visible: true });
    await staleDecision.getByRole("combobox").click();
    await stalePage.getByRole("option", { name: "批准人工报价", exact: true }).click();
    await staleDecision.getByLabel("审核证据", { exact: true }).fill(evidenceId);
    const decision = page.locator(`form#quote-decision-${draft.id}`).filter({ visible: true });
    await decision.getByRole("combobox").click();
    await page.getByRole("option", { name: "退回人工报价", exact: true }).click();
    await decision.getByLabel("审核证据", { exact: true }).fill(evidenceId);
    await decision.locator("textarea").fill("MOCK revision: adjust simulated price");
    await page.getByRole("button", { name: "退回人工报价", exact: true }).click();
    await expect
      .poll(async () => (await records("quotation"))[0].state)
      .toBe("QUOTE_REVISION_REQUIRED");
    const revision = page.locator(`form#quotation-${draft.id}`).filter({ visible: true });
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
    expect(approved.payload.quote).toEqual({
      ...(draft.payload.quote as object),
      unit_price: 13.25,
    });
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
    expect(await records("lead")).toHaveLength(inbound ? 1 : 0);
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
    // Streaming SSR may temporarily stage another copy under a hidden S:* container.
    // Scope to the accessible panel, never select an arbitrary first duplicate.
    const quotationDetails = page.getByRole("region", { name: "报价详情与审批" });
    const send = quotationDetails.locator(`form#quote-send-${draft.id}`);
    await expect(send).toHaveCount(1);
    await expect(send).toBeVisible();
    // Approval alone is not delivery. A simulated receipt is registered below.
    expect((await records("quotation"))[0].state).toBe("QUOTE_APPROVED");
    await send.getByLabel("发送渠道", { exact: true }).fill(channelRef);
    await send.getByLabel("外部发送凭证", { exact: true }).fill(conversationId);
    await quotationDetails.locator(`button[form="quote-send-${draft.id}"]`).click();
    await expect.poll(async () => (await records("quotation"))[0].state).toBe("QUOTE_SENT");
    await expect.poll(async () => (await records("lead")).length).toBe(1);
    const [lead] = await records("lead");
    if (inbound) {
      expect(lead.id).toBe(receivedLeadId);
      expect(lead.payload.conversation_ref).toBe(conversationId);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(lead.state).toBe("FOLLOW_UP");
    expect(lead.payload.score_band).toBe("COLD");
    expect(lead.payload.quotation_ref).toBe(draft.id);
    // Simulated external inbound boundary only; business writes below remain real UI actions.
    if (!inbound)
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
    await page.getByRole("link", { name: "继续客户跟进", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认有效商机", exact: true })).toHaveCount(0);
    await expect(page.getByText(/商机尚待确认：/)).toBeVisible();
    const follow = page.locator(`form#follow-up-${lead.id}`).filter({ visible: true });
    await follow.getByRole("combobox").click();
    await page.getByRole("option", { name: "询问交期", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "人工确认并发送此回复", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "客户询问交期或样品", exact: true }).click();
    await page.getByLabel("请求证据", { exact: true }).fill(evidenceId);
    await page.getByRole("button", { name: "申请工厂确认交期", exact: true }).click();
    await expect.poll(async () => (await records("delivery_confirmation")).length).toBe(1);
    const [delivery] = await records("delivery_confirmation");
    await page.getByRole("link", { name: "查看交期确认", exact: true }).click();
    // Choosing a follow-up context remains an unsaved draft while requesting delivery.
    const discard = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(follow.getByRole("combobox")).toContainText("询问交期");
    await page.getByRole("link", { name: "查看交期确认", exact: true }).click();
    await discard.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/records/delivery/${delivery.id}$`));
    const deliveryForm = page.locator(`form#delivery-${delivery.id}`).filter({ visible: true });
    await deliveryForm.getByRole("combobox").click();
    await page.getByRole("option", { name: "确认交期", exact: true }).click();
    await deliveryForm.getByLabel("确认交期（天）", { exact: true }).fill("21");
    await deliveryForm.getByLabel("审核证据", { exact: true }).fill(evidenceId);
    await page.getByRole("button", { name: "确认人工交期", exact: true }).click();
    await expect
      .poll(async () => (await records("delivery_confirmation"))[0].state)
      .toBe("DELIVERY_CONFIRMATION_CONFIRMED");
    await page.getByRole("link", { name: "返回客户跟进", exact: true }).click();
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
    // Exercise every MVP context through the form and verify persisted outcomes.
    // A fresh synthetic confirmation prevents idempotent replay of the first reply.
    const scenarios = [
      ["quote_sent_unread", "报价未读", "wait_then_reference_quote_validity"],
      ["quote_sent_read_no_reply", "已读未回复", "ask_one_decision_blocking_question"],
      ["price_high", "反馈价格高", "ask_target_budget_and_escalate"],
      ["purchase_later", "稍后采购", "record_timing_and_request_follow_up_consent"],
      ["asks_sample", "询问样品", "collect_sample_requirements_and_escalate"],
      ["asks_lead_time", "询问交期", "request_factory_delivery_confirmation"],
    ] as const;
    const queuedIds = new Set([job.id]);
    for (const [scenario, label, expectedAction] of scenarios) {
      await test.step(`persist follow-up context: ${scenario}`, async () => {
        const confirmation = `evidence-mock-${randomUUID()}`;
        await db.insert(schema.evidence).values({
          id: confirmation,
          classification: "internal",
          blobKey: `synthetic/mock-follow-up-${confirmation}-not-a-real-blob`,
          contentType: "text/plain",
          sha256: createHash("sha256").update(confirmation).digest("hex"),
          sizeBytes: 0,
          sourceLabel: "MOCK follow-up confirmation — synthetic test only",
          uploadedByType: "human",
          uploadedById: actorId,
        });
        await page.goto(`/workspace/${projectId}/records/lead/${lead.id}`);
        await follow.getByRole("combobox").click();
        await page.getByRole("option", { name: label, exact: true }).click();
        const draft = `MOCK ${scenario}: synthetic acceptance only.`;
        await follow.getByLabel("待人工发送内容", { exact: true }).fill(draft);
        await follow.getByLabel("本次人工确认凭据", { exact: true }).fill(confirmation);
        await page.getByRole("button", { name: "人工确认并发送此回复", exact: true }).click();
        await expect
          .poll(async () => {
            const current = (await records("lead"))[0];
            return {
              context: current.payload.follow_up_context,
              action: current.payload.next_action,
              changed: !queuedIds.has(String(current.payload.last_outbound_ref)),
            };
          })
          .toEqual({ context: scenario, action: expectedAction, changed: true });
        const current = (await records("lead"))[0];
        expect(current.state).toBe("FOLLOW_UP");
        const outboundId = String(current.payload.last_outbound_ref);
        queuedIds.add(outboundId);
        const [queued] = await db
          .select()
          .from(schema.socialBrowserJob)
          .where(eq(schema.socialBrowserJob.id, outboundId));
        expect(queued).toMatchObject({ kind: "reply", status: "queued", channelRef });
        const [message] = await db
          .select()
          .from(schema.socialMessage)
          .where(eq(schema.socialMessage.id, queued.payloadRef));
        expect(message.direction).toBe("outbound");
        const plaintext = decryptSocialMessageBody(message.bodyCiphertext);
        expect(plaintext).toContain(draft);
        expect(message.bodyCiphertext).not.toContain(draft);
        if (scenario === "asks_sample" || scenario === "asks_lead_time") {
          expect(plaintext).toContain("21");
        } else {
          expect(plaintext).toBe(draft);
        }
        const audits = await db
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.aggregateId, lead.id),
              eq(schema.auditEvent.action, "lead.follow_up_submitted"),
            ),
          );
        expect(audits.map((item) => item.metadata)).toContainEqual(
          expect.objectContaining({
            context: scenario,
            browser_job_id: outboundId,
            confirmation_ref: confirmation,
          }),
        );
        await page.reload();
        await expect(follow.getByRole("combobox").locator('[data-slot="select-value"]')).toHaveText(
          label,
        );
      });
    }
    expect(queuedIds.size).toBe(7);
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
        await db
          .select()
          .from(schema.socialBrowserJob)
          .where(eq(schema.socialBrowserJob.id, job.id))
      )[0].status,
    ).toBe("queued");
    // No worker is connected: queued is not delivered, and all confirmations are simulated.
  });
}

test("stale RFQ form rejects after archival and owner can reopen", async ({
  page,
  context,
  baseURL,
}) => {
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
  await page.goto(`/workspace/${projectId}/new/rfq`);
  const form = page.locator("form#create-rfq").filter({ visible: true });
  await form.getByLabel("客户名称", { exact: true }).fill("SYNTHETIC stale form");
  await form.getByLabel("录入证据", { exact: true }).fill(evidenceId);
  // Archive in another request after the browser has already obtained a writable form.
  await db
    .update(schema.workspaceProject)
    .set({ status: "archived" })
    .where(eq(schema.workspaceProject.id, projectId));
  await page.getByRole("button", { name: "保存询盘", exact: true }).click();
  await expect(
    page.getByText("项目已归档，请重开后再写入业务资料。", { exact: true }),
  ).toBeVisible();
  expect(
    await db
      .select()
      .from(schema.aggregateRecord)
      .where(
        and(
          eq(schema.aggregateRecord.createdById, actorId),
          eq(schema.aggregateRecord.type, "rfq"),
        ),
      ),
  ).toHaveLength(0);
  await page.goto(`/workspace/${projectId}`);
  await page.getByRole("button", { name: "重开项目", exact: true }).click();
  await expect(page.getByRole("button", { name: "归档项目", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  await expect(page.getByRole("button", { name: "重开项目", exact: true })).toBeVisible();
});
