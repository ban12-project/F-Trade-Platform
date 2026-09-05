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
const path = `/workspace/${projectId}?panel=product`;

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
});
test.afterAll(async () => {
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
  test.describe(`${viewport.width}px project shell`, () => {
    test.use({ viewport });
    test("direct load exposes the real header while data is gated", async ({
      page,
      baseURL,
    }, testInfo) => {
      await instant(
        page,
        async () => {
          await page.goto(path);
          await page.screenshot({ path: testInfo.outputPath("shell.png") });
          await expect(page.getByTestId("project-back-link")).toBeVisible();
          await expect(page.getByText("关键动作需人工确认", { exact: true })).toBeVisible();
          await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
        },
        { baseURL },
      );
      await page.reload();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    });
    test("Link navigation keeps the real header mounted through streaming", async ({
      page,
    }, testInfo) => {
      await page.goto("/workspace");
      let header: import("@playwright/test").ElementHandle<HTMLElement | SVGElement> | null = null;
      await instant(page, async () => {
        await page
          .getByRole("link", { name: new RegExp(title) })
          .first()
          .click();
        await expect(page).toHaveURL(new RegExp(`/workspace/${projectId}$`));
        await page.screenshot({ path: testInfo.outputPath("shell.png") });
        await expect(page.getByTestId("project-back-link")).toBeVisible();
        await expect(page.getByText("关键动作需人工确认", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
        header = await page.getByTestId("project-back-link").elementHandle();
        await page.getByTestId("project-back-link").focus();
      });
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByTestId("project-back-link")).toBeFocused();
      if (!header) throw new Error("Missing mounted header control");
      expect(
        await page.evaluate(
          (element) => element === document.querySelector('[data-testid="project-back-link"]'),
          header,
        ),
      ).toBe(true);
      await expect(page.getByRole("tab", { name: "手动录入" })).toBeVisible();
      await expect(page.getByRole("button", { name: "成员 1" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
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
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  await context.addCookies([
    { name: "better-auth.session_token", value: "synthetic-invalid-session", url: baseURL },
  ]);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
});
