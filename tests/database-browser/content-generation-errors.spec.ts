import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import ready from "../../data/fixtures/product-ready.synthetic.json";
import * as schema from "../../lib/db/schema";
import { encryptStoredSecret } from "../../lib/security/encrypted-secret";
import { authSecret, databaseURL, modelConfigKey } from "../../playwright.database.config";

test("ordinary editor receives safe AI errors through real Actions and can edit and retry", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing browser base URL");
  const pool = new Pool({ connectionString: databaseURL });
  const db = drizzle(pool, { schema });
  const [owner, editor, projectId, productId, configId, token] = Array.from({ length: 6 }, () =>
    randomUUID(),
  );
  const marker = "MOCK_PRIVATE_PROVIDER_DO_NOT_USE";
  const browserMessages: string[] = [];
  page.on("console", (message) => browserMessages.push(message.text()));
  page.on("pageerror", (error) => browserMessages.push(error.message));
  const manual = "MOCK newer manual body retained after failure";
  const draft = {
    hook: "MOCK retry hook",
    body: "MOCK successful authorized retry — synthetic test only",
    callToAction: "Discuss the MOCK workflow",
    hashtags: ["#MockTest"],
    visualInstruction: "MOCK abstract text card",
  };
  let requests = 0;
  let started!: () => void;
  let release!: () => void;
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Only the local provider is synthetic. Keep actual SDK, auth, Action, schema and PostgreSQL.
  const provider = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume the request */
    }
    requests++;
    if (requests === 1) {
      started();
      await released;
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: marker, type: "mock_private_failure" } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        id: "mock-content-errors",
        object: "chat.completion",
        created: 1,
        model: "mock-only",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify(requests === 2 ? { hook: marker } : draft),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  let defaultIds: string[] = [];
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    for (const id of [owner, editor])
      await db.insert(schema.user).values({
        id,
        name: "MOCK content error verification",
        email: `${id}@example.invalid`,
        emailVerified: true,
        role: "user",
      });
    await db.insert(schema.session).values({
      id: randomUUID(),
      token,
      userId: editor,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db.insert(schema.workspaceProject).values({
      id: projectId,
      title: "MOCK content errors only",
      kind: "marketing",
      createdById: owner,
    });
    for (const [userId, role] of [
      [owner, "owner"],
      [editor, "editor"],
    ] as const)
      await db.insert(schema.workspaceProjectMember).values({
        id: randomUUID(),
        projectId,
        userId,
        role,
        createdById: owner,
      });
    await db.insert(schema.aggregateRecord).values({
      id: productId,
      type: "product",
      state: "PRODUCT_READY",
      payload: {
        ...ready,
        record_id: productId,
        product: { ...ready.product, product_name: "MOCK content error product" },
      },
      createdByType: "human",
      createdById: owner,
    });
    await db.insert(schema.workspaceProjectItem).values({
      id: randomUUID(),
      projectId,
      aggregateId: productId,
      role: "product_source",
      relation: "owned",
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Missing mock provider port");
    defaultIds = (
      await db
        .select({ id: schema.productAgentModelConfig.id })
        .from(schema.productAgentModelConfig)
        .where(eq(schema.productAgentModelConfig.isDefault, true))
    ).map((row) => row.id);
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = modelConfigKey;
    await db.transaction(async (tx) => {
      await tx.update(schema.productAgentModelConfig).set({ isDefault: false });
      await tx.insert(schema.productAgentModelConfig).values({
        id: configId,
        name: configId,
        isDefault: true,
        provider: "openai-compatible",
        model: "mock-only",
        baseUrl: `http://127.0.0.1:${address.port}/${marker}/v1`,
        apiKeyCiphertext: encryptStoredSecret(marker),
        updatedBy: owner,
      });
    });
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
    const actionBodies: string[] = [];
    await page.route(
      (url) => url.pathname === `/workspace/${projectId}/new/content`,
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST" || !request.headers()["next-action"])
          return route.continue();
        // Capture the real upstream body before forwarding it unchanged. Chromium can
        // evict a completed Flight response before response.text() retrieves it over CDP.
        const response = await route.fetch();
        const body = await response.body();
        actionBodies.push(body.toString("utf8"));
        await route.fulfill({ response, body });
      },
    );
    await page.goto(`/workspace/${projectId}/new/content?product=${productId}`);
    const form = page.locator("form#create-content").filter({ visible: true });
    await expect(form).toBeVisible();
    await form.getByRole("combobox", { name: "允许引用的产品事实", exact: true }).click();
    await page.getByRole("option", { name: "产品名称", exact: true }).click();
    const generate = form.getByRole("button", { name: /生成可编辑初稿/ });
    await form.getByLabel("营销目标", { exact: true }).fill("MOCK error verification");
    await form.getByLabel("目标客户", { exact: true }).fill("MOCK test-only buyer");
    await form.getByLabel("正文", { exact: true }).fill("MOCK initial manual body");
    const actionResponse = () =>
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          Boolean(response.request().headers()["next-action"]),
      );
    const failedResponse = actionResponse();
    await generate.click();
    await received;
    await expect(generate).toBeDisabled();
    await form.getByLabel("正文", { exact: true }).fill(manual);
    release();
    const failed = await failedResponse;
    expect(failed.ok()).toBe(true);
    expect(actionBodies).toHaveLength(1);
    expect(actionBodies[0]).not.toContain(marker);
    await expect(page.getByText(/AI 初稿生成失败.*重试.*管理员/)).toBeVisible();
    await expect(form.getByLabel("正文", { exact: true })).toHaveValue(manual);
    await expect(generate).toBeEnabled();
    const malformedResponse = actionResponse();
    await generate.click();
    expect((await malformedResponse).ok()).toBe(true);
    expect(actionBodies).toHaveLength(2);
    expect(actionBodies[1]).not.toContain(marker);
    await expect(page.getByText(/AI 初稿生成失败.*重试.*管理员/)).toBeVisible();
    await expect(form.getByLabel("正文", { exact: true })).toHaveValue(manual);
    await expect(generate).toBeEnabled();
    const retryResponse = actionResponse();
    await generate.click();
    expect((await retryResponse).ok()).toBe(true);
    expect(actionBodies).toHaveLength(3);
    expect(actionBodies[2]).not.toContain(marker);
    await expect(form.getByLabel("正文", { exact: true })).toHaveValue(draft.body);
    await expect(page.getByText("AI 初稿已生成；请人工核对后再创建待审内容。")).toBeVisible();
    expect(requests).toBe(3);
    expect(await page.locator("body").innerText()).not.toContain(marker);
    expect(browserMessages.join("\n")).not.toContain(marker);
    const contents = await db
      .select({ id: schema.aggregateRecord.id })
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.createdById, editor));
    expect(contents).toHaveLength(0);
  } finally {
    release?.();
    if (provider.listening)
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    await db
      .delete(schema.productAgentModelConfig)
      .where(eq(schema.productAgentModelConfig.id, configId));
    if (defaultIds.length)
      await db
        .update(schema.productAgentModelConfig)
        .set({ isDefault: true })
        .where(inArray(schema.productAgentModelConfig.id, defaultIds));
    await db.delete(schema.session).where(eq(schema.session.token, token));
    await pool.end();
  }
});
