import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";
import { seedPublicationAccessFixture } from "../fixtures/publication-access";

const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
test.afterAll(async () => {
  await pool.end();
});

test("current text composer commits one durable batch through its Server Action", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Local application URL required");
  const f = await seedPublicationAccessFixture(db as unknown as Database, "text");
  const scopes = [
    {
      channelRef: f.channelRef,
      accountRef: f.accountRef,
      audience: "Public",
      expiresAt: Date.now() + 3600000,
      textOnly: false,
    },
  ];
  await db.execute(
    sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{publicationScopes}', ${JSON.stringify(scopes)}::jsonb) WHERE id = ${f.nodeId}`,
  );
  const signature = createHmac("sha256", authSecret).update(f.token).digest("base64");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${f.token}.${signature}`),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`/workspace/${f.projectId}/records/content/${f.contentId}`);
  await page.getByRole("checkbox", { name: /合成权限测试账号/ }).check();
  await expect(page.getByText("范围：公开（所有人）", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认公开发布到 1 个账号", exact: true }).click();
  const publications = () =>
    db
      .select()
      .from(schema.socialPublication)
      .where(eq(schema.socialPublication.projectId, f.projectId));
  await expect.poll(async () => (await publications()).length).toBe(1);
  const jobs = await db
    .select()
    .from(schema.socialBrowserJob)
    .where(eq(schema.socialBrowserJob.accountRef, f.accountRef));
  expect(jobs).toHaveLength(1);
  const audits = await db
    .select()
    .from(schema.auditEvent)
    .where(eq(schema.auditEvent.actorId, f.actorId));
  expect(audits.filter((a) => a.action === "social_publication.batch_submitted")).toHaveLength(1);
  await page.reload();
  expect(await publications()).toHaveLength(1);
  await expect(page.getByText("已发布", { exact: true })).toHaveCount(0);
});
