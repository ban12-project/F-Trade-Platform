import { expect, type Page, test } from "@playwright/test";

const configurations = {
  openai: {
    name: "日常产品导入",
    option: "日常产品导入（默认）",
    provider: "OpenAI",
    model: "gpt-5-mini",
    baseUrl: "https://openai.synthetic.invalid/v1",
    headersJson: '{"x-synthetic-config":"openai"}',
    isDefault: true,
    discoveredCount: 2,
    apiKeyConfigured: true,
    authTokenConfigured: false,
  },
  anthropic: {
    name: "复杂目录识别",
    option: "复杂目录识别",
    provider: "Anthropic",
    model: "claude-sonnet-test",
    baseUrl: "https://anthropic.synthetic.invalid/v1",
    headersJson: '{"x-synthetic-config":"anthropic"}',
    isDefault: false,
    discoveredCount: 1,
    apiKeyConfigured: false,
    authTokenConfigured: true,
  },
};

function input(page: Page, label: string) {
  return page.getByLabel(label, { exact: true });
}

function checkbox(page: Page, name: string) {
  return page.getByRole("checkbox", { name, exact: true });
}

function selectedValue(page: Page, index: number) {
  return page.locator('#agent-settings [data-slot="select-value"]').nth(index);
}

async function openSettings(page: Page, empty = false) {
  await page.goto(`/testing/agent-settings${empty ? "?empty=1" : ""}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(input(page, "配置名称")).toBeVisible();
}

async function selectConfiguration(page: Page, option: string) {
  await page.getByRole("combobox", { name: "模型配置", exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function expectClearedCredentials(page: Page) {
  await expect(page.locator("#agent-api-key")).toHaveValue("");
  await expect(page.locator("#agent-auth-token")).toHaveValue("");
  await expect(checkbox(page, "清除已有 API key")).not.toBeChecked();
  await expect(checkbox(page, "清除已有 Auth token")).not.toBeChecked();
}

async function expectConfiguration(page: Page, key: keyof typeof configurations) {
  const config = configurations[key];
  await expect(selectedValue(page, 0)).toHaveText(config.option);
  await expect(input(page, "配置名称")).toHaveValue(config.name);
  await expect(selectedValue(page, 1)).toHaveText(config.provider);
  await expect(input(page, "默认模型")).toHaveValue(config.model);
  await expect(input(page, "Base URL")).toHaveValue(config.baseUrl);
  await expect(input(page, "自定义 Headers（JSON）")).toHaveValue(config.headersJson);
  await expect(checkbox(page, "作为默认模型")).toBeChecked({ checked: config.isDefault });
  const discovered = `已发现 ${config.discoveredCount} 个模型`;
  await expect(page.getByText(discovered, { exact: false })).toBeVisible();
  await expect(page.locator('label[for="agent-api-key"]')).toHaveText(
    config.apiKeyConfigured ? "API key （已配置）" : "API key",
  );
  await expect(page.locator('label[for="agent-auth-token"]')).toHaveText(
    config.authTokenConfigured ? "Auth token （已配置）" : "Auth token",
  );
  await expectClearedCredentials(page);
}

async function editAllFields(page: Page) {
  await input(page, "配置名称").fill("Synthetic unsaved configuration");
  await input(page, "默认模型").fill("synthetic-unsaved-model");
  await input(page, "Base URL").fill("https://unsaved.synthetic.invalid/v1");
  await input(page, "自定义 Headers（JSON）").fill('{"x-synthetic":"unsaved"}');
  await page.locator("#agent-api-key").fill("synthetic-unsaved-key");
  await page.locator("#agent-auth-token").fill("synthetic-unsaved-token");
  await checkbox(page, "清除已有 API key").check();
  await checkbox(page, "清除已有 Auth token").check();
  await checkbox(page, "作为默认模型").click();
}

async function captureSubmission(page: Page) {
  // Inspect the real Server Action payload without executing a settings/database write.
  await page.route("**/testing/agent-settings**", async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });
  const requestPromise = page.waitForRequest(
    (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
  const request = await requestPromise;
  const data = await new Response(request.postData() ?? "", {
    headers: { "Content-Type": request.headers()["content-type"] },
  }).formData();
  // React prefixes FormData keys with the argument id, e.g. _1_name or 1_name.
  return Object.fromEntries(
    Array.from(data.entries(), ([key, value]) => [key.replace(/^_?\d+_/, ""), value]),
  );
}

test("saved configurations synchronize all fields on A to B to A", async ({ page }) => {
  await openSettings(page);
  await expectConfiguration(page, "openai");
  await editAllFields(page);
  await selectConfiguration(page, configurations.anthropic.option);
  await expectConfiguration(page, "anthropic");
  await editAllFields(page);
  await selectConfiguration(page, configurations.openai.option);
  await expectConfiguration(page, "openai");
});

test("new configuration clears edits and credentials before returning", async ({ page }) => {
  await openSettings(page);
  await editAllFields(page);
  await selectConfiguration(page, "新建模型配置");
  await expect(input(page, "配置名称")).toHaveValue("");
  await expect(input(page, "默认模型")).toHaveValue("gpt-5-mini");
  await expect(selectedValue(page, 1)).toHaveText("OpenAI");
  await expect(input(page, "Base URL")).toHaveValue("");
  await expect(input(page, "自定义 Headers（JSON）")).toHaveValue("{}");
  await expect(checkbox(page, "作为默认模型")).not.toBeChecked();
  await expect(page.locator('label[for="agent-api-key"]')).toHaveText("API key");
  await expect(page.locator('label[for="agent-auth-token"]')).toHaveText("Auth token");
  await expectClearedCredentials(page);
  await editAllFields(page);
  await selectConfiguration(page, configurations.anthropic.option);
  await expectConfiguration(page, "anthropic");
});

test("switching clears validation and submits the current configuration", async ({ page }) => {
  await openSettings(page);
  await input(page, "配置名称").fill("");
  await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(input(page, "配置名称")).toHaveAttribute("aria-invalid", "true");
  await selectConfiguration(page, configurations.anthropic.option);
  await expectConfiguration(page, "anthropic");
  await expect(input(page, "配置名称")).toHaveAttribute("aria-invalid", "false");
  await input(page, "配置名称").fill("Synthetic edited Anthropic");
  await input(page, "默认模型").fill("synthetic-edited-model");
  const values = await captureSubmission(page);
  expect(values).toMatchObject({
    configId: "00000000-0000-4000-8000-000000000502",
    name: "Synthetic edited Anthropic",
    provider: "anthropic",
    model: "synthetic-edited-model",
    baseUrl: configurations.anthropic.baseUrl,
    headersJson: configurations.anthropic.headersJson,
    isDefault: "false",
    apiKey: "",
    authToken: "",
    clearApiKey: "false",
    clearAuthToken: "false",
  });
});

test("the first configuration has new defaults and an empty id", async ({ page }) => {
  await openSettings(page, true);
  await expect(selectedValue(page, 0)).toHaveText("新建模型配置");
  await expect(input(page, "配置名称")).toHaveValue("");
  await expect(input(page, "默认模型")).toHaveValue("gpt-5-mini");
  await expect(checkbox(page, "作为默认模型")).toBeChecked();
  await expectClearedCredentials(page);
  await input(page, "配置名称").fill("Synthetic first configuration");
  const values = await captureSubmission(page);
  expect(values).toMatchObject({
    configId: "",
    name: "Synthetic first configuration",
    provider: "openai",
    model: "gpt-5-mini",
    baseUrl: "",
    headersJson: "{}",
    isDefault: "true",
    apiKey: "",
    authToken: "",
    clearApiKey: "false",
    clearAuthToken: "false",
  });
});
