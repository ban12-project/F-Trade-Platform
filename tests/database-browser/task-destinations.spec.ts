import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import delivery from "../../data/fixtures/delivery-confirmation-pending.synthetic.json";
import productReady from "../../data/fixtures/product-ready.synthetic.json";
import quotation from "../../data/fixtures/quotation-review-required.synthetic.json";
import rfq from "../../data/fixtures/rfq-draft.synthetic.json";
import * as schema from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";

// Hardcoded isolated database from the browser config; never reads .env credentials.
const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
const actorId = `synthetic-task-navigation-${randomUUID()}`;
const token = randomUUID();
const projectIds: string[] = [];
const recordIds: string[] = [];

async function project(kind: "sales" | "marketing" = "sales") {
  const id = randomUUID();
  projectIds.push(id);
  await db.insert(schema.workspaceProject).values({
    id,
    kind,
    title: `SYNTHETIC task navigation ${id}`,
    createdById: actorId,
  });
  await db.insert(schema.workspaceProjectMember).values({
    id: randomUUID(),
    projectId: id,
    userId: actorId,
    role: "owner",
    createdById: actorId,
  });
  return id;
}

async function record(
  projectId: string,
  type: typeof schema.aggregateRecord.$inferInsert.type,
  state: string,
  payload: Record<string, unknown>,
  role: typeof schema.workspaceProjectItem.$inferInsert.role,
) {
  const id = randomUUID();
  recordIds.push(id);
  await db.insert(schema.aggregateRecord).values({
    id,
    type,
    state,
    payload:
      type === "lead"
        ? { ...payload, lead_id: id }
        : type === "product"
          ? { ...payload, record_id: id }
          : payload,
    createdByType: "human",
    createdById: actorId,
  });
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId,
    aggregateId: id,
    role,
    relation: "owned",
  });
  return id;
}

async function lead(projectId: string, received = false, hot = false) {
  return record(
    projectId,
    "lead",
    received ? "LEAD_RECEIVED" : "FOLLOW_UP",
    {
      status: received ? "received" : "follow_up",
      score: hot ? 90 : 10,
      score_band: hot ? "HOT" : "COLD",
      score_reasons: [],
      next_action: "synthetic-review",
    },
    "sales_lead",
  );
}

async function approval(
  aggregateId: string,
  gate: typeof schema.approval.$inferInsert.gate,
  approved = false,
) {
  await db.insert(schema.approval).values({
    id: randomUUID(),
    aggregateId,
    gate,
    status: approved ? "approved" : "pending",
    requestedByType: "human",
    requestedById: actorId,
    requestedAt: new Date(),
    ...(approved
      ? {
          decidedByType: "human" as const,
          decidedById: actorId,
          decidedAt: new Date(),
          evidenceRef: "evidence-synthetic-task-navigation",
        }
      : {}),
  });
}

test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.user).values({
    id: actorId,
    name: "Synthetic task reviewer",
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
});
test.beforeEach(async ({ context, baseURL }) => {
  await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, actorId));
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
});
test.afterAll(async () => {
  if (projectIds.length) {
    await db
      .delete(schema.socialPublication)
      .where(inArray(schema.socialPublication.projectId, projectIds));
    await db
      .delete(schema.workspaceProjectItem)
      .where(inArray(schema.workspaceProjectItem.projectId, projectIds));
    await db
      .delete(schema.workspaceProjectMember)
      .where(inArray(schema.workspaceProjectMember.projectId, projectIds));
    await db.delete(schema.workspaceProject).where(inArray(schema.workspaceProject.id, projectIds));
  }
  if (recordIds.length) {
    await db.delete(schema.approval).where(inArray(schema.approval.aggregateId, recordIds));
    await db.delete(schema.aggregateRecord).where(inArray(schema.aggregateRecord.id, recordIds));
  }
  await db.delete(schema.session).where(eq(schema.session.userId, actorId));
  await db.delete(schema.user).where(eq(schema.user.id, actorId));
  await pool.end();
});

test("HOT task opens its candidate, including legacy links, without unrelated leads", async ({
  page,
}) => {
  const id = await project();
  const hot = await lead(id, false, true);
  const other = await lead(id);
  await page.goto("/workspace");
  const href = `/workspace/${id}/records/lead/${hot}`;
  await page.locator("#my-tasks").locator(`a[href="${href}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/records/lead/${hot}$`));
  const panel = page.getByRole("region", { name: "商机详情与审批" });
  await expect(panel.locator(`#follow-up-${hot}`)).toBeVisible();
  await expect(panel.locator(`#follow-up-${other}`)).toHaveCount(0);
  await panel.getByLabel("商机确认凭据").fill("evidence-synthetic-task-navigation");
  await expect(panel.getByRole("button", { name: "确认有效商机", exact: true })).toBeEnabled();
  // Navigate after discarding this test-only input through a new document.
  await page.goto(`/workspace/${id}?panel=lead&item=${hot}`);
  await expect(panel.locator(`#follow-up-${hot}`)).toBeVisible();
  await page.goto(`/workspace/${id}?panel=opportunity`);
  await expect(panel.locator(`#follow-up-${hot}`)).toBeVisible();
  await expect(panel.locator(`#follow-up-${other}`)).toHaveCount(0);
});

test("quotation tasks and default entry survive existing leads and target the selected quote", async ({
  page,
}) => {
  const id = await project();
  await lead(id);
  const other = await record(
    id,
    "quotation",
    "QUOTE_REVIEW_REQUIRED",
    quotation,
    "sales_quotation",
  );
  const chosen = await record(
    id,
    "quotation",
    "QUOTE_REVIEW_REQUIRED",
    quotation,
    "sales_quotation",
  );
  await approval(chosen, "gate_02_quote");
  await page.goto(`/workspace/${id}`);
  await expect(page.getByRole("link", { name: "报价", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.locator(`a[href="/workspace/${id}/records/quotation/${chosen}"]`).click();
  const panel = page.getByRole("region", { name: "报价详情与审批" });
  await expect(panel.locator(`#quote-decision-${chosen}`)).toBeVisible();
  await expect(panel.locator(`#quote-decision-${other}`)).toHaveCount(0);
  await expect(panel.locator("#quotation-new")).toHaveCount(0);
  await panel.getByRole("link", { name: "返回记录列表" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/customers[?]project=${id}$`));
  await expect(page.getByRole("heading", { name: "客户与询盘", exact: true })).toBeVisible();
  await expect(
    page.getByRole("main").locator(`a[href="/workspace/${id}/records/quotation/${other}"]`),
  ).toBeVisible();
});

test("new lead task opens RFQ creation with that lead selected and reopens its existing RFQ", async ({
  page,
}) => {
  const id = await project();
  const received = await lead(id, true);
  await record(id, "rfq", "RFQ_COLLECTING", rfq, "sales_rfq");
  await page.goto(`/workspace/${id}?panel=rfq`);
  await page.locator(`a[href="/workspace/${id}/new/rfq?lead=${received}"]`).click();
  const panel = page.getByRole("region", { name: "需求确认详情与审批" });
  const form = panel.locator("#create-rfq");
  await expect(form).toBeVisible();
  await expect(form.getByRole("combobox", { name: "来源入站线索（可选）" })).toContainText(
    "已选择入站线索",
  );
  await form.getByRole("combobox", { name: "来源入站线索（可选）" }).click();
  await expect(
    page.getByRole("option", { name: `入站线索 ${received.slice(0, 8)}`, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.goto(`/workspace/${id}?panel=lead&item=${received}`);
  await expect(form).toBeVisible();
  await expect(form.getByRole("combobox", { name: "来源入站线索（可选）" })).toContainText(
    "已选择入站线索",
  );
  const linked = await record(
    id,
    "rfq",
    "RFQ_COLLECTING",
    { ...rfq, lead_ref: received },
    "sales_rfq",
  );
  await page.reload();
  await expect(panel.locator(`#revise-rfq-${linked}`)).toBeVisible();
  await expect(form).toHaveCount(0);
});

test("delivery task isolates its confirmation and unknown IDs never fall back to another record", async ({
  page,
}) => {
  const id = await project();
  const other = await record(
    id,
    "delivery_confirmation",
    "DELIVERY_CONFIRMATION_PENDING",
    delivery,
    "delivery_confirmation",
  );
  const chosen = await record(
    id,
    "delivery_confirmation",
    "DELIVERY_CONFIRMATION_PENDING",
    delivery,
    "delivery_confirmation",
  );
  await page.goto(`/workspace/${id}?panel=delivery&item=${chosen}`);
  const panel = page.getByRole("region", { name: "交期详情与审批" });
  await expect(panel.locator(`#delivery-${chosen}`)).toBeVisible();
  await expect(panel.locator(`#delivery-${other}`)).toHaveCount(0);
  for (const stage of ["quotation", "delivery", "follow-up", "rfq"]) {
    await page.goto(`/workspace/${id}?panel=${stage}&item=${randomUUID()}`);
    await expect(page.getByText("这条记录已不可用", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /详情与审批/ }).locator("form")).toHaveCount(0);
  }
});

test("publication link selects its approved payload and unavailable targets cannot publish a substitute", async ({
  page,
}) => {
  const id = await project("marketing");
  const other = await record(
    id,
    "content",
    "CONTENT_APPROVED",
    { status: "approved", hook: "SYNTHETIC other", body: "Other synthetic payload" },
    "marketing_content",
  );
  const chosen = await record(
    id,
    "content",
    "CONTENT_APPROVED",
    { status: "approved", hook: "SYNTHETIC chosen", body: "Chosen synthetic payload" },
    "marketing_content",
  );
  await approval(other, "gate_01_truth", true);
  await approval(chosen, "gate_01_truth", true);
  await page.goto(`/workspace/${id}?panel=publication&item=${chosen}`);
  const panel = page.getByRole("region", { name: "发布详情与审批" });
  await expect(panel.getByText("Chosen synthetic payload", { exact: true })).toBeVisible();
  await expect(panel.getByText("Other synthetic payload", { exact: true })).toHaveCount(0);
  const publicationId = randomUUID();
  await db.insert(schema.socialPublication).values([
    {
      id: publicationId,
      projectId: id,
      channelRef: "synthetic-chosen-channel",
      accountRef: "synthetic-account",
      contentRef: chosen,
      format: "text",
      confirmationRef: "synthetic-chosen-confirmation",
      status: "unknown",
    },
    {
      id: randomUUID(),
      projectId: id,
      channelRef: "synthetic-other-channel",
      accountRef: "synthetic-account",
      contentRef: other,
      format: "text",
      confirmationRef: "synthetic-other-confirmation",
      status: "published",
      externalPublicationRef: "synthetic-other-post",
    },
  ]);
  await page.goto(`/workspace/${id}?panel=publication&item=${publicationId}`);
  await expect(panel.getByText("synthetic-chosen-channel", { exact: false })).toBeVisible();
  await expect(panel.getByText("结果待人工核对", { exact: true })).toBeVisible();
  await expect(panel.getByText(/系统不会自动重试/)).toBeVisible();
  await expect(panel.locator("#publication-confirmation")).toHaveCount(0);
  for (const [status, label] of [
    ["failed", "发布失败"],
    ["paused", "发布已暂停"],
    ["published", "已发布"],
  ]) {
    await db
      .update(schema.socialPublication)
      .set({ status })
      .where(eq(schema.socialPublication.id, publicationId));
    await page.reload();
    await expect(panel.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(panel.getByText("synthetic-other-post", { exact: false })).toHaveCount(0);
  await expect(panel.getByText("Other synthetic payload", { exact: true })).toHaveCount(0);
  await page.goto(`/workspace/${id}?panel=publication&item=${randomUUID()}`);
  await expect(panel.getByText("这条记录已不可用", { exact: true })).toBeVisible();
  await expect(panel.locator("#publication-confirmation")).toHaveCount(0);
});

test("review tasks respect application role, project role and archival without changing approval gates", async ({
  page,
}) => {
  const id = await project();
  const quote = await record(
    id,
    "quotation",
    "QUOTE_REVIEW_REQUIRED",
    quotation,
    "sales_quotation",
  );
  await approval(quote, "gate_02_quote");
  const href = `/workspace/${id}/records/quotation/${quote}`;
  const actionable = page.locator("#my-tasks").locator(`a[href="${href}"]`);
  const waiting = page.locator("#my-tasks").locator(`a[href="${href}"]`);
  await page.goto("/workspace");
  await expect(actionable).toBeVisible();
  await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, actorId));
  await page.reload();
  await expect(actionable).toHaveCount(0);
  await page.getByRole("link", { name: /等待他人/ }).click();
  await expect(waiting).toBeVisible();
  await waiting.click();
  const panel = page.getByRole("region", { name: "报价详情与审批" });
  await expect(panel.locator(`#quote-decision-${quote}`)).toHaveCount(0);
  await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, actorId));
  await db
    .update(schema.workspaceProjectMember)
    .set({ role: "viewer" })
    .where(eq(schema.workspaceProjectMember.projectId, id));
  await page.goto("/workspace");
  await expect(actionable).toHaveCount(0);
  await page.getByRole("link", { name: /等待他人/ }).click();
  await expect(waiting).toBeVisible();
  await waiting.click();
  await expect(panel.getByText("当前为只读视图。请由项目编辑者处理写入或审核。")).toBeVisible();
  await page.goto(`/workspace/${id}?panel=quotation`);
  await panel.getByRole("link", { name: `人工报价 ${quote.slice(0, 8)}` }).click();
  await expect(panel.getByText("当前为只读视图。请由项目编辑者处理写入或审核。")).toBeVisible();
  await expect(panel.locator(`#quote-decision-${quote}`)).toHaveCount(0);
  await db
    .update(schema.workspaceProjectMember)
    .set({ role: "editor" })
    .where(eq(schema.workspaceProjectMember.projectId, id));
  await page.goto("/workspace");
  await expect(actionable).toBeVisible();
  await db
    .update(schema.workspaceProject)
    .set({ status: "archived" })
    .where(eq(schema.workspaceProject.id, id));
  await page.reload();
  await expect(actionable).toHaveCount(0);
  await expect(waiting).toHaveCount(0);
});

test("unused ready product and RFQ tasks open the intended creation context", async ({ page }) => {
  const marketing = await project("marketing");
  await record(
    marketing,
    "product",
    "PRODUCT_READY",
    {
      ...productReady,
      product: { ...productReady.product, product_name: "SYNTHETIC unrelated source" },
    },
    "product_source",
  );
  const product = await record(
    marketing,
    "product",
    "PRODUCT_READY",
    {
      ...productReady,
      product: { ...productReady.product, product_name: "SYNTHETIC chosen source" },
    },
    "product_source",
  );
  await page.goto("/workspace");
  await page
    .locator("#my-tasks")
    .locator(`a[href="/workspace/${marketing}/new/content?product=${product}"]`)
    .click();
  const contentPanel = page.getByRole("region", { name: "营销内容详情与审批" });
  await contentPanel.getByRole("combobox").first().click();
  await expect(page.getByRole("option", { name: /SYNTHETIC chosen source/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("option", { name: /SYNTHETIC unrelated source/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const sales = await project();
  const request = await record(sales, "rfq", "RFQ_READY", rfq, "sales_rfq");
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId: sales,
    aggregateId: product,
    role: "product_reference",
    relation: "reference",
  });
  await page.goto("/workspace");
  await page
    .locator("#my-tasks")
    .locator(`a[href="/workspace/${sales}/new/quotation?rfq=${request}"]`)
    .click();
  const quotePanel = page.getByRole("region", { name: "报价详情与审批" });
  await expect(quotePanel.locator("#quotation-new")).toBeVisible();
  await quotePanel.getByRole("combobox").first().click();
  await expect(page.getByRole("option")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("option")).toHaveText("clutch_kit · 500");
});

test("revisions, scheduled follow-ups and pending publication receipts have distinct task states", async ({
  page,
}) => {
  const sales = await project();
  const revised = await record(
    sales,
    "quotation",
    "QUOTE_REVISION_REQUIRED",
    quotation,
    "sales_quotation",
  );
  const planned = await record(
    sales,
    "lead",
    "FOLLOW_UP",
    {
      status: "follow_up",
      score_band: "COLD",
      score: 10,
      score_reasons: [],
      next_action: "synthetic-follow-up",
      next_follow_up_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
    "sales_lead",
  );
  const marketing = await project("marketing");
  const content = await record(
    marketing,
    "content",
    "CONTENT_APPROVED",
    { hook: "SYNTHETIC receipt", body: "Synthetic only" },
    "marketing_content",
  );
  const publication = randomUUID();
  await db.insert(schema.socialPublication).values({
    id: publication,
    projectId: marketing,
    channelRef: "synthetic-task-states",
    accountRef: "synthetic-account",
    contentRef: content,
    format: "text",
    confirmationRef: "synthetic-task-states",
    status: "submitted",
  });
  const revisionHref = `/workspace/${sales}/records/quotation/${revised}`;
  const receiptHref = `/workspace/${marketing}/records/publication/${publication}`;
  await page.goto("/workspace");
  await expect(page.locator("#my-tasks").locator(`a[href="${revisionHref}"]`)).toContainText(
    "修订人工报价",
  );
  await page.getByRole("link", { name: /已安排/ }).click();
  await expect(
    page.locator("#my-tasks").locator(`a[href="/workspace/${sales}/records/lead/${planned}"]`),
  ).toBeVisible();
  await page.getByRole("link", { name: /系统处理中/ }).click();
  await expect(page.locator("#my-tasks").locator(`a[href="${receiptHref}"]`)).toBeVisible();
  await page.getByRole("link", { name: /我可处理/ }).click();
  await expect(page.locator("#my-tasks").locator(`a[href="${receiptHref}"]`)).toHaveCount(0);
  await page.goto(`/workspace/${sales}`);
  await expect(page.getByRole("link", { name: /报价/ }).first()).toHaveAttribute(
    "aria-current",
    "page",
  );
  await db
    .update(schema.socialPublication)
    .set({ status: "unknown" })
    .where(eq(schema.socialPublication.id, publication));
  await page.goto("/workspace");
  await expect(page.locator("#my-tasks").locator(`a[href="${receiptHref}"]`)).toContainText(
    "需要排查",
  );
  await page.getByRole("link", { name: /系统处理中/ }).click();
  await expect(page.locator("#my-tasks").locator(`a[href="${receiptHref}"]`)).toHaveCount(0);
});

test("object libraries retain project scope, reference ownership and stable record navigation", async ({
  page,
}) => {
  const marketing = await project("marketing");
  const sales = await project();
  const hidden = await project("marketing");
  const product = await record(
    marketing,
    "product",
    "PRODUCT_READY",
    {
      ...productReady,
      product: { ...productReady.product, product_name: "SYNTHETIC library selected" },
    },
    "product_source",
  );
  const unrelated = await record(
    hidden,
    "product",
    "PRODUCT_READY",
    {
      ...productReady,
      product: { ...productReady.product, product_name: "SYNTHETIC library inaccessible" },
    },
    "product_source",
  );
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId: sales,
    aggregateId: product,
    role: "product_reference",
    relation: "reference",
  });
  await db
    .delete(schema.workspaceProjectMember)
    .where(eq(schema.workspaceProjectMember.projectId, hidden));
  await page.goto(`/workspace/products?project=${marketing}`);
  const chosenHref = `/workspace/${marketing}/records/product/${product}`;
  await expect(page.locator(`a[href="${chosenHref}"]`)).toBeVisible();
  await expect(page.getByText("SYNTHETIC library inaccessible")).toHaveCount(0);
  await page.locator(`a[href="${chosenHref}"]`).click();
  await expect(
    page.getByRole("cell", { name: "SYNTHETIC library selected", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "SYNTHETIC library selected", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("归属项目")).toHaveValue(marketing);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${product}$`));
  await page.goto(`/workspace/products?project=${sales}`);
  await expect(page.getByText(/引用资料，只读/)).toBeVisible();
  await page.locator(`a[href="/workspace/${sales}/records/product/${product}"]`).click();
  await expect(
    page
      .getByRole("region", { name: "引用的产品详情与审批" })
      .getByText("当前为只读视图。请由项目编辑者处理写入或审核。"),
  ).toBeVisible();
  await page.getByRole("link", { name: "引用的产品", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/records/product/${product}$`));
  await page.goto(`/workspace/products?project=${hidden}`);
  await expect(page.getByText("这个项目不可访问")).toBeVisible();
  await expect(page.getByText("SYNTHETIC library inaccessible")).toHaveCount(0);
  await page.goto(`/workspace/${marketing}/records/product/${unrelated}`);
  await expect(page.getByText("这条记录已不可用", { exact: true })).toBeVisible();
});

test("malformed or contradictory object links never substitute a form or another record", async ({
  page,
}) => {
  const id = await project("marketing");
  const chosen = await record(id, "product", "PRODUCT_READY", productReady, "product_source");
  for (const path of [
    `/workspace/${id}/records/product/not-a-uuid`,
    `/workspace/${id}/records/product/${chosen}?item=${randomUUID()}`,
    `/workspace/${id}/records/product/${chosen}?product=${chosen}`,
    `/workspace/${id}/new/content?product=invalid`,
    `/workspace/${id}?panel=product&item=invalid`,
    `/workspace/${id}?panel=content&product=invalid`,
  ]) {
    await page.goto(path);
    await expect(page.getByText("这条记录已不可用", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /详情与审批/ }).locator("form")).toHaveCount(0);
  }
});

test("new work reuses an explicit project and creates ownership only when selected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await project();
  await record(id, "rfq", "RFQ_COLLECTING", rfq, "sales_rfq");
  const before = await db.select({ id: schema.workspaceProject.id }).from(schema.workspaceProject);
  await page.goto("/workspace");
  await page.getByRole("main").getByRole("button", { name: "开始新工作", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "开始新工作" });
  await dialog.getByRole("button", { name: "记录询盘", exact: true }).click();
  await dialog.getByLabel("归属项目").selectOption(id);
  await dialog.getByRole("button", { name: "在此项目开始记录询盘" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${id}/new/rfq$`));
  await expect(page.locator("#create-rfq")).toBeVisible();
  expect(
    (await db.select({ id: schema.workspaceProject.id }).from(schema.workspaceProject)).length,
  ).toBe(before.length);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "开始新工作", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  for (let tab = 0; tab < 10; tab++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
  }
  await dialog.getByLabel("归属项目").selectOption("new");
  await dialog.getByLabel("项目名称").fill("SYNTHETIC explicit new ownership");
  await dialog.getByRole("button", { name: "创建项目并开始" }).click();
  await expect(page).toHaveURL(/\/workspace\/[^/]+\/new\/product$/);
  const createdId = new URL(page.url()).pathname.split("/")[2];
  projectIds.push(createdId);
  await expect(
    page.getByRole("heading", { name: "SYNTHETIC explicit new ownership" }),
  ).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
