import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";

const connectionString = process.env.PROJECT_ACCESS_TEST_DATABASE_URL ?? databaseURL;
const address = new URL(connectionString);
if (
  address.hostname !== "127.0.0.1" ||
  !["/f_trade_browser_test", "/project_access_test"].includes(address.pathname)
)
  throw new Error("Dedicated synthetic local database required");
const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema });
const actorId = randomUUID(),
  ownerId = randomUUID(),
  token = randomUUID();
const ownId = randomUUID(),
  hiddenId = randomUUID(),
  missingId = randomUUID();
const title = "SYNTHETIC accessible project",
  hiddenTitle = "SYNTHETIC restricted project";
const cookie = {
  name: "better-auth.session_token",
  value: encodeURIComponent(
    `${token}.${createHmac("sha256", authSecret).update(token).digest("base64")}`,
  ),
  domain: "127.0.0.1",
  path: "/",
  expires: Math.floor(Date.now() / 1000) + 3600,
  httpOnly: true,
  secure: false,
  sameSite: "Lax" as const,
};
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values(
    [actorId, ownerId].map((id) => ({
      id,
      name: "Synthetic access reviewer",
      email: `${id}@example.invalid`,
      emailVerified: true,
      role: "admin",
    })),
  );
  await db.insert(schema.session).values({
    id: randomUUID(),
    token,
    userId: actorId,
    expiresAt: new Date(Date.now() + 3600000),
  });
  await db.insert(schema.workspaceProject).values([
    { id: ownId, title, kind: "marketing", createdById: actorId },
    { id: hiddenId, title: hiddenTitle, kind: "marketing", createdById: ownerId },
  ]);
  await db.insert(schema.workspaceProjectMember).values([
    { id: randomUUID(), projectId: ownId, userId: actorId, role: "viewer", createdById: actorId },
    { id: randomUUID(), projectId: hiddenId, userId: ownerId, role: "owner", createdById: ownerId },
  ]);
  if (process.env.PROJECT_ACCESS_TEST_STATE_FILE)
    await writeFile(
      process.env.PROJECT_ACCESS_TEST_STATE_FILE,
      JSON.stringify({ cookies: [cookie], origins: [] }),
      { mode: 0o600 },
    );
});
test.afterAll(async () => {
  if (!process.env.PROJECT_ACCESS_TEST_STATE_FILE) {
    await db
      .delete(schema.workspaceProject)
      .where(inArray(schema.workspaceProject.id, [ownId, hiddenId]));
    await db.delete(schema.session).where(eq(schema.session.userId, actorId));
    await db.delete(schema.user).where(inArray(schema.user.id, [actorId, ownerId]));
  }
  await pool.end();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies([cookie]);
});
for (const suffix of ["", "/video"]) {
  for (const [kind, id] of [
    ["missing", missingId],
    ["nonmember", hiddenId],
    ["malformed", "not-a-project"],
  ]) {
    test(`${kind} project${suffix} gives the same recoverable unavailable page`, async ({
      page,
    }) => {
      await page.goto(`/workspace/${id}${suffix}`);
      await expect(page.getByRole("heading", { name: "无法打开此项目" })).toBeVisible();
      await expect(
        page.getByText("该项目不可用，或你没有查看权限。", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "返回工作台", exact: true })).toBeVisible();
      expect(await page.content()).not.toContain(hiddenTitle);
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
      await page.getByRole("link", { name: "返回工作台", exact: true }).click();
      await expect(page).toHaveURL(/\/workspace$/);
      await expect(page.getByRole("link", { name: new RegExp(title) }).first()).toBeVisible();
    });
  }
}
test("viewer access works and membership revocation takes effect on a fresh request", async ({
  page,
}) => {
  await page.goto(`/workspace/${ownId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await db
    .delete(schema.workspaceProjectMember)
    .where(
      and(
        eq(schema.workspaceProjectMember.projectId, ownId),
        eq(schema.workspaceProjectMember.userId, actorId),
      ),
    );
  await page.reload();
  await expect(page.getByRole("heading", { name: "无法打开此项目" })).toBeVisible();
  expect(await page.content()).not.toContain(title);
});
test("unauthenticated project access still redirects to authentication", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto(`/workspace/${hiddenId}`);
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.content()).not.toContain(hiddenTitle);
});
