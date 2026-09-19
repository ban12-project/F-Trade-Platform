import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { listProjectPublicationData } from "../../lib/social/publication-store";
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
  const submit = page.locator('button[form="publication-confirmation"]:visible');
  await expect(confirmation).toHaveCount(1);
  await expect(submit).toHaveCount(1);
  await expect(submit).toHaveAccessibleName("确认并提交此条发布");
  await expect
    .poll(() =>
      submit.evaluate(
        (button: HTMLButtonElement) =>
          button.form === document.querySelector("#publication-confirmation:not([hidden])") &&
          !!button.form?.checkVisibility(),
      ),
    )
    .toBe(true);
  await expect(confirmation.getByText("SYNTHETIC preview one", { exact: true })).toBeVisible();
  await confirmation.getByLabel("逐帖人工确认凭据").fill("evidence-synthetic-preview");
  await db
    .update(schema.aggregateRecord)
    .set({
      version: 2,
      payload: { status: "approved", body: "SYNTHETIC preview two", hook: "SYNTHETIC" },
    })
    .where(eq(schema.aggregateRecord.id, contentRef));
  await submit.click();
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
  await submit.click();
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

test("older unknown results stay addressable and cannot reappear as publish candidates", async ({
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
  const older = randomUUID();
  await db.insert(schema.socialPublication).values(
    Array.from({ length: 52 }, (_, index) => ({
      id: index === 0 ? older : randomUUID(),
      projectId,
      channelRef,
      accountRef,
      contentRef,
      format: "text",
      confirmationRef: `synthetic-history-${index}`,
      status: index === 0 ? "unknown" : "paused",
      createdAt: new Date(Date.now() + index * 1000),
    })),
  );
  const data = await listProjectPublicationData(projectId, db as unknown as Database);
  expect(data.publications.some((item) => item.id === older)).toBe(true);
  expect(data.candidates).toHaveLength(0);
  expect(
    data.publications.every((item) => !("textConfirmation" in item) && !("browserJobId" in item)),
  ).toBe(true);
  await page.goto(`/workspace/${projectId}/records/publication/${older}`);
  const detail = page.getByRole("region", { name: "发布详情与审批" });
  await expect(detail.getByText("结果待人工核对", { exact: true })).toBeVisible();
  await expect(detail.locator("#publication-confirmation")).toHaveCount(0);
});
