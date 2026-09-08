import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
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
  throw new Error("Only an isolated local synthetic database is permitted");
const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema });
const actorId = randomUUID();
const token = randomUUID();
const accountRef = `synthetic-egress-${randomUUID()}`;
const nodeName = `Synthetic egress node ${randomUUID()}`;

test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values({
    id: actorId,
    name: "Synthetic node reviewer",
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
test.afterAll(async () => {
  await pool.end();
});

test("expected egress is required by the actual account form and persisted with its grant", async ({
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
  await page.goto("/workspace/browsers");
  await page.getByLabel("节点名称", { exact: true }).fill(nodeName);
  await page
    .getByLabel("接管域名，例如 https://browser-a.example.com")
    .fill("https://synthetic-browser.example.invalid");
  await page.getByRole("button", { name: "创建节点并生成 Key", exact: true }).click();
  await expect(page.getByRole("button", { name: "我已保存，隐藏 Key" })).toBeVisible();
  await page.getByRole("button", { name: "我已保存，隐藏 Key" }).click();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: nodeName, exact: true }).click();
  await page.getByLabel("账号标识（固定不变）", { exact: true }).fill(accountRef);
  await page
    .getByLabel("固定 HTTP 代理主机", { exact: true })
    .fill("synthetic-proxy.example.invalid");
  await page.getByLabel("代理端口", { exact: true }).fill("3128");
  const expectedIp = page.getByLabel("预期固定出口 IP（由代理服务商确认）", { exact: true });
  await expectedIp.fill("auto");
  await page.getByRole("button", { name: "保存账号授权", exact: true }).click();
  await expect(expectedIp).toHaveAttribute("aria-invalid", "true");
  const before = await pool.query("SELECT id FROM browser_fleet_binding WHERE account_ref=$1", [
    accountRef,
  ]);
  expect(before.rowCount).toBe(0);
  await expectedIp.fill("203.0.113.10");
  await page.getByRole("button", { name: "保存账号授权", exact: true }).click();
  await expect
    .poll(async () => {
      const { rows } = await pool.query(
        "SELECT n.document FROM browser_fleet_node n JOIN browser_fleet_binding b ON b.node_id=n.id WHERE b.account_ref=$1",
        [accountRef],
      );
      return rows[0]?.document.accounts.find(
        (a: { accountRef: string }) => a.accountRef === accountRef,
      )?.expectedEgressIp;
    })
    .toBe("203.0.113.10");
  await expect(expectedIp).toHaveAttribute("aria-invalid", "false");
});
