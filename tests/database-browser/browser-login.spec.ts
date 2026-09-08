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
  await page.getByRole("button", { name: "接入登录 / 2FA", exact: true }).click();
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
    page.getByText("填充结果未知，本次不再重试。请重新接入后核对。", { exact: true }),
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
});
