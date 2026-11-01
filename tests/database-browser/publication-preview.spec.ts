import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { initialState } from "../../lib/browser-fleet/policy";
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
const nodeId = randomUUID();
const accountId = randomUUID();
const secondaryId = randomUUID();
const secondaryRef = randomUUID();
const fleet = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
fleet.installationId = randomUUID();
fleet.bootId = randomUUID();
fleet.lastSeenAt = Date.now();
fleet.capabilities = ["interactive", "publish"];
fleet.accounts = [
  {
    id: accountId,
    displayName: "合成出口账号",
    channelRef,
    accountRef,
    enabled: true,
    authState: "ready",
    loginCiphertext: null,
    proxyCiphertext: "SYNTHETIC",
    expectedEgressIp: "203.0.113.10",
    credentialVersion: 1,
    pollSeconds: 0,
    nextPollAt: 0,
    lastCheckedAt: null,
  },
];
fleet.accounts.push({
  ...fleet.accounts[0],
  id: secondaryId,
  accountRef: secondaryRef,
  displayName: "合成备用账号",
  authState: "needs_login",
});
async function saveFleet() {
  fleet.lastSeenAt = Date.now();
  await pool.query("UPDATE browser_fleet_node SET document=$1 WHERE id=$2", [
    JSON.stringify(fleet),
    nodeId,
  ]);
}
function contentPayload(body: string) {
  return {
    content_id: contentRef,
    product_id: randomUUID(),
    content_type: "product",
    objective: "SYNTHETIC",
    target_customer: "SYNTHETIC",
    platform: "pending-channel-decision",
    product_facts: [],
    call_to_action: "",
    hashtags: [],
    visual_instruction: "",
    status: "approved",
    body,
    hook: "SYNTHETIC",
  };
}

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
    payload: contentPayload("SYNTHETIC preview one"),
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
  await pool.query(
    "INSERT INTO browser_fleet_node(id,owner_id,name,gateway_origin,key_hash,document) VALUES($1,$2,$3,$4,$5,$6)",
    [
      nodeId,
      actor,
      "合成发布服务",
      "https://synthetic.example.invalid",
      randomUUID(),
      JSON.stringify(fleet),
    ],
  );
  await pool.query(
    "INSERT INTO browser_fleet_binding(id,node_id,account_ref,channel_ref) VALUES($1,$2,$3,$4)",
    [accountId, nodeId, accountRef, channelRef],
  );
  await pool.query(
    "INSERT INTO browser_fleet_binding(id,node_id,account_ref,channel_ref) VALUES($1,$2,$3,$4)",
    [secondaryId, nodeId, secondaryRef, channelRef],
  );
  await db.insert(schema.socialChannelControl).values({
    id: randomUUID(),
    channelRef,
    accountRef: secondaryRef,
    enabled: false,
    circuitStatus: "paused",
    pauseReason: "unknown",
    changedAt: now,
    changedBy: actor,
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

test("account status explains blockers, controls select stable accounts, and preserves return destination", async ({
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
  await pool.query(
    "UPDATE social_channel_control SET enabled=false,circuit_status='paused',pause_reason='not_enabled' WHERE account_ref=$1",
    [accountRef],
  );
  await page.goto(`/workspace/${projectId}/records/content/${contentRef}`);
  await page.locator("#publication-channel").selectOption(JSON.stringify([channelRef, accountRef]));
  await expect(
    page.getByText("尚未允许发布，请在账号设置中允许发布。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('button[form="publication-confirmation"]')).toBeDisabled();
  await page.getByRole("link", { name: "去配置渠道（发布账号）" }).click();
  // Existing dirty-state guard preserves user changes until explicitly leaving.
  const leave = page.getByRole("button", { name: /离开|放弃/ });
  if (await leave.count()) await leave.first().click();
  await expect(page.getByRole("heading", { name: "发布账号", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回所选内容，继续发布" })).toHaveAttribute(
    "href",
    `/workspace/${projectId}/records/content/${contentRef}`,
  );
  const accountCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: "合成出口账号" }) })
    .first();
  await expect(accountCard.getByText(/发布：未允许/)).toBeVisible();
  const secondary = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: "合成备用账号" }) })
    .first();
  await expect(secondary.getByText(/登录尚未验证/)).toBeVisible();
  await expect(secondary.getByText(/发布因异常暂停/)).toBeVisible();
  await accountCard.getByLabel("要执行的操作").selectOption("enable");
  await accountCard.getByLabel("处理情况或操作原因").fill("合成测试：已核对登录和发布服务");
  await accountCard.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(accountCard.getByRole("status")).toContainText("允许发布");
  fleet.capabilities = ["interactive"];
  await saveFleet();
  await expect(accountCard.getByText(/当前服务没有发布执行能力/)).toBeVisible({ timeout: 12000 });
  fleet.capabilities = ["interactive", "publish"];
  fleet.accounts[0].authState = "needs_2fa";
  await saveFleet();
  await expect(accountCard.getByText(/登录尚未验证/)).toBeVisible({ timeout: 12000 });
  fleet.accounts[0].authState = "ready";
  await saveFleet();
  await pool.query(
    "UPDATE browser_fleet_node SET document=jsonb_set(document,'{lastSeenAt}','1'::jsonb) WHERE id=$1",
    [nodeId],
  );
  await expect(accountCard.getByText(/发布服务未连接/)).toBeVisible({ timeout: 12000 });
  await saveFleet();
  await page.getByRole("link", { name: "返回所选内容，继续发布" }).click();
  await expect(page.locator("#publication-channel")).toHaveValue(
    JSON.stringify([channelRef, accountRef]),
  );
});

test("submit rechecks authorization and content review without discarding the selected account", async ({
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
  await saveFleet();
  await page.goto(`/workspace/${projectId}/records/content/${contentRef}`);
  await page.locator("#publication-channel").selectOption(JSON.stringify([channelRef, accountRef]));
  fleet.accounts[0].enabled = false;
  await saveFleet();
  const submit = page.locator('button[form="publication-confirmation"]');
  await submit.click();
  await expect(page.getByText("账号授权已停用，请先启用账号授权。", { exact: true })).toBeVisible();
  await expect(page.locator("#publication-channel")).toHaveValue(
    JSON.stringify([channelRef, accountRef]),
  );
  fleet.accounts[0].enabled = true;
  await saveFleet();
  await pool.query("UPDATE aggregate_record SET state='CONTENT_DRAFT' WHERE id=$1", [contentRef]);
  await submit.click();
  await expect(
    page.getByText("只有 Gate 01 已批准内容或视频可以发布。", { exact: true }),
  ).toBeVisible();
  await pool.query("UPDATE aggregate_record SET state='CONTENT_APPROVED' WHERE id=$1", [
    contentRef,
  ]);
  expect(
    (await pool.query("SELECT id FROM social_publication WHERE content_ref=$1", [contentRef])).rows,
  ).toHaveLength(0);
});

test("empty account management explains setup without enabling anything", async ({
  page,
  context,
  baseURL,
}) => {
  expect(
    (
      await page.request.get(
        "/api/publication-preview?projectId=00000000-0000-4000-8000-000000000000",
      )
    ).status(),
  ).toBe(403);
  const emptyActor = randomUUID(),
    emptyToken = randomUUID();
  await db.insert(schema.user).values({
    id: emptyActor,
    name: "Synthetic empty owner",
    email: `${emptyActor}@example.invalid`,
    role: "admin",
    emailVerified: true,
  });
  await db.insert(schema.session).values({
    id: randomUUID(),
    token: emptyToken,
    userId: emptyActor,
    expiresAt: new Date(Date.now() + 3600000),
  });
  const signature = createHmac("sha256", authSecret).update(emptyToken).digest("base64");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${emptyToken}.${signature}`),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  expect(
    (
      await page.request.get(
        "/api/publication-preview?projectId=00000000-0000-4000-8000-000000000000&contentRef=00000000-0000-4000-8000-000000000000&format=image&mediaId=synthetic",
      )
    ).status(),
  ).toBe(404);
  await page.goto("/workspace/settings?section=channels");
  await expect(page.getByText(/尚未添加发布账号。请在下方添加账号/)).toBeVisible();
  await expect(page.getByText(/尚未连接发布服务，请先展开/)).toBeVisible();
  await expect(page.getByRole("button", { name: "保存账号凭据", exact: true })).toBeDisabled();
});

test("unknown result blocks recovery until the publication is reconciled, and recovery is audited", async ({
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
  await saveFleet();
  const unknownId = randomUUID();
  await db.insert(schema.socialPublication).values({
    id: unknownId,
    projectId,
    channelRef,
    accountRef,
    contentRef,
    format: "text",
    confirmationRef: `synthetic-${unknownId}`,
    status: "unknown",
  });
  await pool.query(
    "UPDATE social_channel_control SET enabled=false,circuit_status='paused',pause_reason='unknown' WHERE account_ref=$1",
    [accountRef],
  );
  await page.goto("/workspace/settings?section=channels");
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: "合成出口账号" }) })
    .first();
  await expect(card.getByText(/发布因异常暂停/)).toBeVisible();
  await expect(card.getByRole("link", { name: "查看上次发布结果并核实" })).toHaveAttribute(
    "href",
    `/workspace/${projectId}/records/publication/${unknownId}`,
  );
  await card.getByLabel("要执行的操作").selectOption("resume");
  await card.getByLabel("处理情况或操作原因").fill("合成测试：先核实发布结果");
  await card.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("上次结果待核实");
  // Simulated verified receipt; no network publish and no automatic retry.
  await pool.query(
    "UPDATE social_publication SET status='published', external_publication_ref='https://www.facebook.com/synthetic/posts/1', published_at=now() WHERE id=$1",
    [unknownId],
  );
  await card.getByLabel("处理情况或操作原因").fill("合成测试：已核实原帖成功，人工恢复未来发布");
  await card.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("允许发布");
  const audit = await pool.query(
    "SELECT action FROM audit_event WHERE actor_id=$1 AND action='social_channel_resume'",
    [actor],
  );
  expect(audit.rows.length).toBeGreaterThan(0);
  expect(
    (await pool.query("SELECT status FROM social_publication WHERE id=$1", [unknownId])).rows[0]
      .status,
  ).toBe("published");
  // Remove only this isolated synthetic record so later preview tests can submit.
  await pool.query("DELETE FROM social_publication WHERE id=$1", [unknownId]);
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
  await page.goto(`/workspace/${projectId}/records/content/${contentRef}`);
  await page.locator("#publication-channel").selectOption(JSON.stringify([channelRef, accountRef]));
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

  await db
    .update(schema.aggregateRecord)
    .set({
      version: 2,
      payload: contentPayload("SYNTHETIC preview two"),
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
  await page.locator("#publication-channel").selectOption(JSON.stringify([channelRef, accountRef]));
  await expect(confirmation).toHaveCount(1);
  await expect(confirmation.getByText("SYNTHETIC preview two", { exact: true })).toBeVisible();

  await saveFleet();
  await submit.dblclick();
  await expect
    .poll(async () => {
      const [saved] = await db
        .select()
        .from(schema.socialPublication)
        .where(eq(schema.socialPublication.contentRef, contentRef));
      return saved?.textConfirmation?.contentVersion;
    })
    .toBe(2);
  expect(
    (await pool.query("SELECT id FROM social_publication WHERE content_ref=$1", [contentRef])).rows,
  ).toHaveLength(1);
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
  const detail = page.getByRole("region", { name: "业务记录" });
  await expect(detail.getByText("结果待人工核对", { exact: true })).toBeVisible();
  await expect(detail.locator("#publication-confirmation")).toHaveCount(0);
});
