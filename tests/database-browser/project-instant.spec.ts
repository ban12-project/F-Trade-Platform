import { createHmac, randomUUID } from "node:crypto";
import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";

const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
const actorId = `synthetic-instant-${randomUUID()}`;
const projectId = randomUUID();
const token = randomUUID();
const title = "MOCK instant navigation project";
const recordId = randomUUID();
const recordTitle = "MOCK instant product";
const path = `/workspace/${projectId}/records/product/${recordId}`;

test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values({
    id: actorId,
    name: "Synthetic navigation reviewer",
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
  await db
    .insert(schema.workspaceProject)
    .values({ id: projectId, title, kind: "marketing", createdById: actorId });
  await db
    .insert(schema.workspaceProjectMember)
    .values({ id: randomUUID(), projectId, userId: actorId, role: "owner", createdById: actorId });
  await db.insert(schema.aggregateRecord).values({
    id: recordId,
    type: "product",
    state: "PRODUCT_REVIEW_REQUIRED",
    createdByType: "human",
    createdById: actorId,
    payload: {
      record_id: recordId,
      source_ref: "synthetic-instant-source",
      evidence_refs: [],
      verification_status: "review_required",
      blocking_missing_fields: [],
      optional_missing_fields: [],
      field_evidence: {},
      product: {
        product_name: recordTitle,
        internal_sku: "MOCK-INSTANT",
        product_type: "clutch_kit",
      },
    },
  });
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId,
    aggregateId: recordId,
    role: "product_source",
    relation: "owned",
  });
  await db.insert(schema.approval).values({
    id: randomUUID(),
    aggregateId: recordId,
    gate: "gate_01_truth",
    status: "pending",
    requestedByType: "human",
    requestedById: actorId,
    requestedAt: new Date(),
  });
});
test.afterAll(async () => {
  await db
    .delete(schema.workspaceProjectItem)
    .where(eq(schema.workspaceProjectItem.projectId, projectId));
  await db.delete(schema.approval).where(eq(schema.approval.aggregateId, recordId));
  await db.delete(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, recordId));
  await db
    .delete(schema.workspaceProjectMember)
    .where(eq(schema.workspaceProjectMember.projectId, projectId));
  await db.delete(schema.workspaceProject).where(eq(schema.workspaceProject.id, projectId));
  await db.delete(schema.session).where(eq(schema.session.userId, actorId));
  await db.delete(schema.user).where(eq(schema.user.id, actorId));
  await pool.end();
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

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}px record shell`, () => {
    test.use({ viewport });
    test("direct record load paints the frame and independent loading regions", async ({
      page,
      baseURL,
    }, testInfo) => {
      await instant(
        page,
        async () => {
          await page.goto(path);
          await expect(page.getByTestId("record-frame")).toBeVisible();
          await expect(
            page.getByRole("status", { name: "正在加载记录信息", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("status", { name: "正在加载业务记录", exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("heading", { name: recordTitle, exact: true })).toHaveCount(
            0,
          );
          await page.screenshot({ path: testInfo.outputPath("shell.png") });
        },
        { baseURL },
      );
      await page.reload();
      await expect(page.getByRole("heading", { name: recordTitle, exact: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "项目栏目" })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("loaded.png"), fullPage: true });
    });
    test("record Link keeps its main landmark mounted and focused through streaming", async ({
      page,
    }, testInfo) => {
      await page.goto(`/workspace/products?project=${projectId}`);
      let frame: import("@playwright/test").ElementHandle<HTMLElement | SVGElement> | null = null;
      await instant(page, async () => {
        await page.getByRole("link", { name: new RegExp(recordTitle) }).click();
        await expect(page.getByTestId("record-frame")).toBeVisible();
        await expect(page.getByRole("heading", { name: recordTitle, exact: true })).toHaveCount(0);
        frame = await page.getByTestId("record-frame").elementHandle();
        await page.getByTestId("record-frame").focus();
        await page.screenshot({ path: testInfo.outputPath("shell.png") });
      });
      await expect(page.getByRole("heading", { name: recordTitle, exact: true })).toBeVisible();
      await expect(page.getByTestId("record-frame")).toBeFocused();
      if (!frame) throw new Error("Missing real static record frame");
      expect(
        await page.evaluate(
          (element) => element === document.querySelector('[data-testid="record-frame"]'),
          frame,
        ),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByRole("link", { name: "返回清单", exact: true })).toHaveAttribute(
        "href",
        `/workspace/products?project=${projectId}`,
      );
      await page.screenshot({ path: testInfo.outputPath("loaded.png"), fullPage: true });
    });
  });
}

test("unauthenticated and invalid sessions cannot read project data", async ({
  page,
  context,
  baseURL,
}) => {
  await context.clearCookies();
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: recordTitle })).toHaveCount(0);
  await context.addCookies([
    { name: "better-auth.session_token", value: "synthetic-invalid-session", url: baseURL },
  ]);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: recordTitle })).toHaveCount(0);
});

for (const target of ["products", "content", "customers"]) {
  test(`${target} has an immediate page title on hard and soft navigation`, async ({
    page,
    baseURL,
  }) => {
    const heading = { products: "产品资料", content: "内容与发布", customers: "客户与询盘" }[
      target
    ];
    await instant(
      page,
      async () => {
        await page.goto(`/workspace/${target}`);
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      },
      { baseURL },
    );
    await page.goto("/workspace");
    await instant(page, async () => {
      await page
        .getByRole("navigation", { name: "主要导航" })
        .getByRole("link", { name: heading, exact: true })
        .click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    });
  });
}
for (const route of ["new/product", `records/product/${randomUUID()}`]) {
  test(`${route.split("/")[0]} keeps an independent record frame on direct navigation`, async ({
    page,
    baseURL,
  }) => {
    await instant(
      page,
      async () => {
        await page.goto(`/workspace/${projectId}/${route}`);
        await expect(page.getByTestId("record-frame")).toBeVisible();
      },
      { baseURL },
    );
  });
}
