import { expect, type Page, test } from "@playwright/test";

const firstId = "00000000-0000-4000-8000-000000000501";

async function openAgent(page: Page) {
  await page.goto("/testing/agent-settings?section=agent");
  await expect(page.getByLabel("配置名称", { exact: true })).toBeVisible();
}

async function refreshSettings(page: Page) {
  const revision = page.getByRole("status", { name: "合成配置版本" });
  const before = await revision.textContent();
  await page.getByRole("button", { name: "刷新合成配置", exact: true }).click();
  await expect(revision).not.toHaveText(before ?? "");
}

async function successResponses(page: Page) {
  const posts: Record<string, FormDataEntryValue>[] = [];
  await page.route("**/testing/agent-settings**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const request = route.request();
    const data = await new Response(request.postData() ?? "", {
      headers: { "Content-Type": request.headers()["content-type"] },
    }).formData();
    posts.push(
      Object.fromEntries(
        [...data.entries()].map(([key, value]) => [key.replace(/^_?\d+_/, ""), value]),
      ),
    );
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: "success", message: "SYNTHETIC configuration saved", savedConfigId: firstId })}\n`,
    });
  });
  return posts;
}

for (const scenario of ["new draft", "selected configuration"] as const) {
  test(`refresh after saving preserves ${scenario}`, async ({ page }) => {
    await successResponses(page);
    await openAgent(page);
    await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
    await expect(page.getByText("SYNTHETIC configuration saved", { exact: true })).toBeVisible();
    if (scenario === "selected configuration") {
      await page.getByRole("combobox", { name: "模型配置", exact: true }).click();
      await page.getByRole("option", { name: "复杂目录识别", exact: true }).click();
    }
    await page.getByLabel("默认模型", { exact: true }).fill("synthetic-next-draft");
    await page.locator("#agent-api-key").fill("synthetic-unsubmitted-key");
    await refreshSettings(page);
    await expect(page.getByLabel("默认模型", { exact: true })).toHaveValue("synthetic-next-draft");
    await expect(page.locator("#agent-api-key")).toHaveValue("synthetic-unsubmitted-key");
    await expect(page.getByRole("combobox", { name: "模型配置", exact: true })).toContainText(
      scenario === "selected configuration" ? "复杂目录识别" : "日常产品导入",
    );
  });
}

test("every successful configuration save clears submitted credentials without reverting its values", async ({
  page,
}) => {
  const posts = await successResponses(page);
  await openAgent(page);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.getByLabel("默认模型", { exact: true }).fill(`  synthetic-saved-${attempt}  `);
    await page.locator("#agent-api-key").fill(`synthetic-key-${attempt}`);
    await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
    await expect(page.getByText("SYNTHETIC configuration saved", { exact: true })).toBeVisible();
    await expect(page.locator("#agent-api-key")).toHaveValue("");
    await expect(page.getByLabel("默认模型", { exact: true })).toHaveValue(
      `synthetic-saved-${attempt}`,
    );
    expect(posts).toHaveLength(attempt);
    expect(posts.at(-1)).toMatchObject({
      model: `synthetic-saved-${attempt}`,
      apiKey: `synthetic-key-${attempt}`,
    });
  }
});

test("pending configuration is locked and denial preserves its draft across refresh", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/testing/agent-settings**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    await held;
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: calls === 1 ? "error" : "success", message: calls === 1 ? "SYNTHETIC denied" : "SYNTHETIC recovered", savedConfigId: firstId })}\n`,
    });
  });
  await openAgent(page);
  const model = page.getByLabel("默认模型", { exact: true });
  const key = page.locator("#agent-api-key");
  const save = page.locator('button[form="agent-settings"]');
  await model.fill("synthetic-denied-draft");
  await key.fill("synthetic-denied-key");
  try {
    await save.click();
    await expect.poll(() => calls).toBe(1);
    await expect(page.locator("#agent-settings")).toHaveAttribute("aria-busy", "true");
    for (const control of [
      model,
      key,
      save,
      page.getByRole("combobox", { name: "模型配置", exact: true }),
      page.getByRole("combobox", { name: "Provider", exact: true }),
    ]) {
      await expect(control).toBeDisabled();
    }
  } finally {
    release();
  }
  await expect(page.getByText("SYNTHETIC denied", { exact: true })).toBeVisible();
  await expect(save).toBeEnabled();
  await refreshSettings(page);
  await expect(model).toHaveValue("synthetic-denied-draft");
  await expect(key).toHaveValue("synthetic-denied-key");
  await save.click();
  await expect(page.getByText("SYNTHETIC recovered", { exact: true })).toBeVisible();
  await expect(key).toHaveValue("");
  await expect(model).toHaveValue("synthetic-denied-draft");
  expect(calls).toBe(2);
});

test("a newly saved configuration uses its returned id for the next save before refreshed props arrive", async ({
  page,
}) => {
  const posts = await successResponses(page);
  await page.goto("/testing/agent-settings?section=agent&empty=1");
  await page.getByLabel("配置名称", { exact: true }).fill("SYNTHETIC new configuration");
  await page.locator("#agent-api-key").fill("synthetic-first-key");
  await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(page.locator("#agent-api-key")).toHaveValue("");
  await page.getByLabel("默认模型", { exact: true }).fill("synthetic-second-model");
  await page.locator("#agent-api-key").fill("synthetic-second-key");
  await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(page.locator("#agent-api-key")).toHaveValue("");
  expect(posts).toHaveLength(2);
  expect(posts[0].configId).toBe("");
  expect(posts[1]).toMatchObject({ configId: firstId, model: "synthetic-second-model" });
});
