import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";

const connectionString = process.env.BROWSER_FLEET_UI_TEST_DATABASE_URL ?? databaseURL;
const address = new URL(connectionString);
if (
  address.hostname !== "127.0.0.1" ||
  !["/f_trade_browser_test", "/browser_fleet_test"].includes(address.pathname)
)
  throw new Error("Dedicated loopback synthetic database required");
const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema });
const actor = randomUUID();
const token = randomUUID();
const projectId = randomUUID();
const contentRef = randomUUID();
const channelRef = `synthetic-${randomUUID()}`;
const accountRef = randomUUID();
const now = new Date();

test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.user).values({
    id: actor,
    name: "Synthetic reviewer",
    email: `${actor}@example.invalid`,
    role: "admin",
    emailVerified: true,
  });
  await db
    .insert(schema.session)
    .values({ id: randomUUID(), token, userId: actor, expiresAt: new Date(Date.now() + 3600000) });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    kind: "marketing",
    title: "SYNTHETIC preview regression",
    createdById: actor,
  });
  await db
    .insert(schema.workspaceProjectMember)
    .values({ id: randomUUID(), projectId, userId: actor, role: "owner", createdById: actor });
  await db.insert(schema.aggregateRecord).values({
    id: contentRef,
    type: "content",
    state: "CONTENT_APPROVED",
    payload: { status: "approved", body: "SYNTHETIC preview one", hook: "SYNTHETIC" },
    createdByType: "human",
    createdById: actor,
  });
  await db
    .insert(schema.workspaceProjectItem)
    .values({ id: randomUUID(), projectId, aggregateId: contentRef, role: "marketing_content" });
  await db.insert(schema.approval).values({
    id: randomUUID(),
    aggregateId: contentRef,
    gate: "gate_01_truth",
    status: "approved",
    requestedByType: "human",
    requestedById: actor,
    requestedAt: now,
    decidedByType: "human",
    decidedById: actor,
    decidedAt: now,
    evidenceRef: "evidence-synthetic",
  });
  await db.insert(schema.socialChannelControl).values({
    id: randomUUID(),
    channelRef,
    accountRef,
    enabled: true,
    circuitStatus: "active",
    changedBy: actor,
    changedAt: now,
  });
});
test.afterAll(async () => {
  await pool.end();
});

test("stale displayed preview cannot create a publication; refreshed preview confirms its version", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing local browser URL");
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
  await page.goto(`/workspace/${projectId}?panel=publication`);
  const confirmation = page.locator("#publication-confirmation:visible");
  await expect(confirmation).toHaveCount(1);
  await expect(confirmation.getByText("SYNTHETIC preview one", { exact: true })).toBeVisible();
  await confirmation.getByLabel("逐帖人工确认凭据").fill("evidence-synthetic-preview");
  await db
    .update(schema.aggregateRecord)
    .set({
      version: 2,
      payload: { status: "approved", body: "SYNTHETIC preview two", hook: "SYNTHETIC" },
    })
    .where(eq(schema.aggregateRecord.id, contentRef));
  await confirmation.getByRole("button", { name: "确认并提交此条发布", exact: true }).click();
  await expect(
    page.getByText("内容已更新，请刷新页面、核对新预览后重新确认。", { exact: true }),
  ).toBeVisible();
  expect(
    await db
      .select()
      .from(schema.socialPublication)
      .where(eq(schema.socialPublication.contentRef, contentRef)),
  ).toHaveLength(0);
  await page.reload();
  await expect(confirmation).toHaveCount(1);
  await expect(confirmation.getByText("SYNTHETIC preview two", { exact: true })).toBeVisible();
  await confirmation.getByLabel("逐帖人工确认凭据").fill("evidence-synthetic-preview-current");
  await confirmation.getByRole("button", { name: "确认并提交此条发布", exact: true }).click();
  await expect
    .poll(async () => {
      const [saved] = await db
        .select()
        .from(schema.socialPublication)
        .where(eq(schema.socialPublication.contentRef, contentRef));
      return saved?.textConfirmation?.contentVersion;
    })
    .toBe(2);
});
