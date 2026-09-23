import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { enqueueRun, initialState } from "../../lib/browser-fleet/policy";
import { createAccessKey, digest } from "../../lib/browser-fleet/security";
import * as schema from "../../lib/db/schema";
import { encryptFacebookCredential } from "../../lib/social/facebook-vault-crypto";
import { authSecret, databaseURL } from "../../playwright.database.config";

const connectionString = process.env.BROWSER_FLEET_UI_TEST_DATABASE_URL ?? databaseURL;
const address = new URL(connectionString);
if (
  address.hostname !== "127.0.0.1" ||
  !["/f_trade_browser_test", "/browser_fleet_test"].includes(address.pathname)
)
  throw new Error("Dedicated local synthetic database required");
const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema });
const actorId = randomUUID(),
  sessionId = randomUUID(),
  token = randomUUID();
const nodeId = randomUUID(),
  accountId = randomUUID(),
  runId = randomUUID(),
  leaseId = randomUUID();
const installationId = randomUUID(),
  bootId = randomUUID();
const accessKey = createAccessKey(nodeId);
const credential = {
  username: "synthetic-ui@example.invalid",
  password: "SYNTHETIC private UI password",
};
const scope = { channelRef: "synthetic-login", accountRef: randomUUID() };
const ring = {
  activeKeyId: "synthetic",
  keys: { synthetic: Buffer.alloc(32, 3).toString("base64") },
};
const cookie = encodeURIComponent(
  `${token}.${createHmac("sha256", authSecret).update(token).digest("base64")}`,
);
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values({
    id: actorId,
    name: "Synthetic login reviewer",
    email: `${actorId}@example.invalid`,
    emailVerified: true,
    role: "admin",
  });
  await db
    .insert(schema.session)
    .values({ id: sessionId, token, userId: actorId, expiresAt: new Date(Date.now() + 3600000) });
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 });
  state.installationId = installationId;
  state.bootId = bootId;
  state.capabilities = ["interactive"];
  state.loginFillScopes = [{ ...scope, expiresAt: Date.now() + 3600000 }];
  state.accounts.push({
    id: accountId,
    ...scope,
    expectedEgressIp: "203.0.113.10",
    enabled: true,
    authState: "needs_login",
    credentialVersion: 1,
    loginCiphertext: encryptFacebookCredential(credential, scope, "login", ring),
    proxyCiphertext: encryptFacebookCredential(
      { host: "synthetic-proxy.example.invalid", port: 3128, username: "", password: "" },
      scope,
      "proxy",
      ring,
    ),
    pollSeconds: 0,
    nextPollAt: 0,
    lastCheckedAt: null,
  });
  const run = enqueueRun(
    state,
    {
      id: runId,
      accountId,
      kind: "interactive",
      jobRef: null,
      requestedBy: actorId,
      authSessionId: sessionId,
    },
    Date.now(),
  );
  Object.assign(run, {
    status: "running",
    leaseId,
    leaseUntil: Date.now() + 90000,
    deadline: Date.now() + 600000,
  });
  await pool.query(
    "INSERT INTO browser_fleet_node (id,owner_id,name,gateway_origin,key_hash,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [
      nodeId,
      actorId,
      "Synthetic login UI node",
      "https://synthetic-login-gateway.example.invalid",
      digest(accessKey),
      JSON.stringify(state),
    ],
  );
  await pool.query(
    "INSERT INTO browser_fleet_binding (id,node_id,account_ref,channel_ref) VALUES ($1,$2,$3,$4)",
    [randomUUID(), nodeId, scope.accountRef, scope.channelRef],
  );
  if (process.env.BROWSER_FLEET_TEST_COOKIE_FILE)
    await writeFile(
      process.env.BROWSER_FLEET_TEST_COOKIE_FILE,
      JSON.stringify({
        cookies: [
          {
            name: "better-auth.session_token",
            value: cookie,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
      { mode: 0o600 },
    );
});
test.afterAll(async () => {
  await pool.end();
});
test("saved password fill uses the actual owner action and never returns credentials to the page", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing local browser URL");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.route("https://synthetic-login-gateway.example.invalid/viewer", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<body>Simulated viewer<script>window.addEventListener('message', e => { if(e.data.type === 'ftrade-browser-ticket') document.body.dataset.ticket=e.data.token; }); window.parent.postMessage({type:'ftrade-browser-ready'}, '${baseURL}');</script>`,
    }),
  );
  await page.goto("/workspace/browsers");
  const connect = page.getByRole("button", { name: "接入登录 / 2FA", exact: true });
  await expect(connect).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
  // The final run row must remain reachable at the end of the document.
  // Trial clicks verify hit testing without issuing an extra ticket or forcing a click.
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(async () => {
        const target = await connect.boundingBox();
        return Boolean(target && target.y >= 0 && target.y + target.height <= viewport.height);
      })
      .toBe(true);
    await connect.click({ trial: true });
  }
  await connect.click();
  const viewer = page.frameLocator('iframe[title="账号登录与两步验证"]');
  await expect(viewer.locator("body")).toHaveAttribute("data-ticket", /.+/);
  const ticket = await viewer.locator("body").getAttribute("data-ticket");
  const nodeCall = async (fields: Record<string, unknown>) => {
    const result = await page.request.post(`${baseURL}/api/browser-nodes`, {
      headers: { authorization: `Bearer ${accessKey}` },
      data: { installationId, bootId, ...fields },
    });
    expect(result.status()).toBe(200);
    return result.json();
  };
  await nodeCall({ operation: "admit", ticket });
  const button = page.getByRole("button", { name: "填入已保存账号和密码", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText("填充请求已记录，正在等待节点结果。", { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  const heartbeat = await nodeCall({ operation: "heartbeat", runId, leaseId, ready: true });
  expect(heartbeat.loginAuthorization.id).toBeTruthy();
  const released = await nodeCall({
    operation: "claim-login",
    runId,
    leaseId,
    authorizationId: heartbeat.loginAuthorization.id,
  });
  expect(released.credential).toEqual(credential);
  await nodeCall({ operation: "finish", runId, leaseId, stopped: true, outcome: "unknown" });
  // Node receipts reach this page through its five-second status refresh.
  // Allow the next refresh plus request latency instead of racing its interval.
  await expect(
    page.getByText("登录结果未知，本次不再重试。请重新接入后核对。", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  const interrupted = await pool.query("SELECT document FROM browser_fleet_node WHERE id=$1", [
    nodeId,
  ]);
  expect(interrupted.rows[0].document.runs[0].savedLogin.outcome).toBeUndefined();
  await expect(button).toBeDisabled();
  await nodeCall({
    operation: "login-result",
    runId,
    leaseId,
    authorizationId: heartbeat.loginAuthorization.id,
    outcome: "filled",
  });
  await expect(page.getByText("已填入，请在远程页面完成登录和 2FA。", { exact: true })).toBeVisible(
    { timeout: 15_000 },
  );
  const rows = await pool.query("SELECT document FROM browser_fleet_node WHERE id=$1", [nodeId]);
  expect(rows.rows[0].document.accounts[0].authState).toBe("needs_login");
  expect(await page.content()).not.toContain(credential.password);
  expect(await page.content()).not.toContain(credential.username);
  // Replace this synthetic fixture with an automatic challenge result to verify
  // the polling UI. Broker authorization/replay rules have separate DB coverage.
  const challengeState = rows.rows[0].document;
  Object.assign(challengeState.runs[0].savedLogin, {
    automatic: true,
    outcome: "refused",
    challenge: "checkpoint",
  });
  await pool.query("UPDATE browser_fleet_node SET document=$2::jsonb WHERE id=$1", [
    nodeId,
    JSON.stringify(challengeState),
  ]);
  await expect(
    page.getByText(
      "Facebook 要求额外的人机或设备验证。请人工完成验证后重新接入；本次未自动重试。",
      {
        exact: true,
      },
    ),
  ).toBeVisible({ timeout: 15_000 });
  expect(await page.content()).not.toContain(credential.password);
});

test("owner page reads managed lifecycle changes while cloud provisioning stays disabled", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing local browser URL");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const before = await pool.query(
    "SELECT count(*)::int AS count FROM browser_sandbox_outbox WHERE node_id=$1",
    [nodeId],
  );
  await page.goto("/workspace/browsers");
  await expect(page.getByText("自管服务器", { exact: true })).toBeVisible();
  const updatedAt = "2026-09-01T00:00:00Z";
  try {
    await pool.query(
      "INSERT INTO browser_sandbox (node_id,sandbox_name,updated_at) VALUES ($1,$2,$3)",
      [nodeId, `ftrade-browser-${nodeId}`, updatedAt],
    );
    await expect(page.getByText("按需浏览器", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("已停止", { exact: true })).toBeVisible();
    await expect(page.getByText("不是云端实时状态。", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建托管节点", exact: true })).toBeDisabled();
    const operationId = randomUUID();
    await pool.query(
      "UPDATE browser_sandbox SET phase='unknown', operation_id=$2, operation_kind='start' WHERE node_id=$1",
      [nodeId, operationId],
    );
    await expect(page.getByText("需要核对", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("尚未确认云端是否停止，请先核对，勿重复启动。")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(operationId);
    expect(html).not.toContain(accessKey);
    const after = await pool.query(
      "SELECT count(*)::int AS count FROM browser_sandbox_outbox WHERE node_id=$1",
      [nodeId],
    );
    expect(after.rows).toEqual(before.rows);
    const record = await pool.query(
      "SELECT phase,operation_id FROM browser_sandbox WHERE node_id=$1",
      [nodeId],
    );
    expect(record.rows).toEqual([{ phase: "unknown", operation_id: operationId }]);
  } finally {
    await pool.query("DELETE FROM browser_sandbox WHERE node_id=$1", [nodeId]);
  }
});
