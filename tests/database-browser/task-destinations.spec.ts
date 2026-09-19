import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import delivery from "../../data/fixtures/delivery-confirmation-pending.synthetic.json";
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
    payload: type === "lead" ? { ...payload, lead_id: id } : payload,
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
  const href = `/workspace/${id}?panel=opportunity&item=${hot}`;
  await page.locator("#my-tasks").locator(`a[href="${href}"]`).click();
  await expect(page).toHaveURL(new RegExp(`panel=opportunity&item=${hot}`));
  const panel = page.getByRole("complementary", { name: "商机详情与审批" });
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
  await expect(page.getByRole("link", { name: "步骤 3 报价" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await page.locator(`a[href="/workspace/${id}?panel=quotation&item=${chosen}"]`).click();
  const panel = page.getByRole("complementary", { name: "报价详情与审批" });
  await expect(panel.locator(`#quote-decision-${chosen}`)).toBeVisible();
  await expect(panel.locator(`#quote-decision-${other}`)).toHaveCount(0);
  await expect(panel.locator("#quotation-new")).toHaveCount(0);
  await panel.getByRole("link", { name: "返回本步骤全部记录" }).click();
  await expect(panel.locator("#quotation-new")).toBeVisible();
});

test("new lead task opens RFQ creation with that lead selected and reopens its existing RFQ", async ({
  page,
}) => {
  const id = await project();
  const received = await lead(id, true);
  await record(id, "rfq", "RFQ_COLLECTING", rfq, "sales_rfq");
  await page.goto(`/workspace/${id}?panel=rfq`);
  await page.locator(`a[href="/workspace/${id}?panel=rfq&lead=${received}"]`).click();
  const panel = page.getByRole("complementary", { name: "需求确认详情与审批" });
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
  const panel = page.getByRole("complementary", { name: "交期详情与审批" });
  await expect(panel.locator(`#delivery-${chosen}`)).toBeVisible();
  await expect(panel.locator(`#delivery-${other}`)).toHaveCount(0);
  for (const stage of ["quotation", "delivery", "follow-up", "rfq"]) {
    await page.goto(`/workspace/${id}?panel=${stage}&item=${randomUUID()}`);
    await expect(page.getByText("这条记录已不可用", { exact: true })).toBeVisible();
    await expect(page.getByRole("complementary").locator("form")).toHaveCount(0);
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
  const panel = page.getByRole("complementary", { name: "发布详情与审批" });
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
  await expect(panel.getByText("unknown", { exact: true })).toBeVisible();
  await expect(panel.getByText("synthetic-other-post", { exact: false })).toHaveCount(0);
  await expect(panel.getByText("Other synthetic payload", { exact: true })).toHaveCount(0);
  await page.goto(`/workspace/${id}?panel=publication&item=${randomUUID()}`);
  await expect(panel.getByText("这条记录已不可用", { exact: true })).toBeVisible();
  await expect(panel.locator("#publication-confirmation")).toHaveCount(0);
});
