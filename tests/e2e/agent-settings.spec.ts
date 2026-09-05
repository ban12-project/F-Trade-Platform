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

async function openSettings(page: Page, empty = false) {
  await page.goto(`/testing/agent-settings${empty ? "?empty=1" : ""}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(page.getByLabel("配置名称", { exact: true })).toBeVisible();
}

async function selectConfiguration(page: Page, option: string) {
  await page.getByRole("combobox", { name: "模型配置", exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function expectClearedCredentials(page: Page) {
  await expect(page.locator("#agent-api-key")).toHaveValue("");
  await expect(page.locator("#agent-auth-token")).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "清除已有 API key", exact: true })).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "清除已有 Auth token", exact: true }),
  ).not.toBeChecked();
}

async function expectConfiguration(page: Page, key: keyof typeof configurations) {
  const config = configurations[key];
  await expect(page.getByRole("combobox", { name: "模型配置", exact: true })).toHaveText(
    config.option,
  );
  await expect(page.getByLabel("配置名称", { exact: true })).toHaveValue(config.name);
  await expect(page.locator("#agent-settings").getByRole("combobox").nth(1)).toHaveText(
    config.provider,
  );
  await expect(page.getByLabel("默认模型", { exact: true })).toHaveValue(config.model);
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(config.baseUrl);
  await expect(page.getByLabel("自定义 Headers（JSON）", { exact: true })).toHaveValue(
    config.headersJson,
  );
  await expect(page.getByRole("checkbox", { name: "作为默认模型", exact: true })).toBeChecked({
    checked: config.isDefault,
  });
  await expect(page.getByText(`已发现 ${config.discoveredCount} 个模型`, { exact: false })).toBeVisible();
  await expect(page.locator('label[for="agent-api-key"]')).toHaveText(
    config.apiKeyConfigured ? "API key （已配置）" : "API key",
  );
  await expect(page.locator('label[for="agent-auth-token"]')).toHaveText(
    config.authTokenConfigured ? "Auth token （已配置）" : "Auth token",
  );
  await expectClearedCredentials(page);
}

async function editAllFields(page: Page) {
  await page.getByLabel("配置名称", { exact: true }).fill("Synthetic unsaved configuration");
  await page.getByLabel("默认模型", { exact: true }).fill("synthetic-unsaved-model");
  await page.getByLabel("Base URL", { exact: true }).fill("https://unsaved.synthetic.invalid/v1");
  await page.getByLabel("自定义 Headers（JSON）", { exact: true }).fill('{"x-synthetic":"unsaved"}');
  await page.locator("#agent-api-key").fill("synthetic-unsaved-key");
  await page.locator("#agent-auth-token").fill("synthetic-unsaved-token");
  await page.getByRole("checkbox", { name: "清除已有 API key", exact: true }).check();
  await page.getByRole("checkbox", { name: "清除已有 Auth token", exact: true }).check();
  await page.getByRole("checkbox", { name: "作为默认模型", exact: true }).click();
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
  // React prefixes fields with the serialized FormData argument's numeric identifier.
  return Object.fromEntries(
    Array.from(data.entries(), ([key, value]) => [key.replace(/^\d+_/, ""), value]),
  );
}

test("saved model configurations synchronize every field on A to B to A switches", async ({
  page,
}) => {
  await openSettings(page);
  await expectConfiguration(page, "openai");
  await editAllFields(page);
  await selectConfiguration(page, configurations.anthropic.option);
  await expectConfiguration(page, "anthropic");
  await editAllFields(page);
  await selectConfiguration(page, configurations.openai.option);
  await expectConfiguration(page, "openai");
});

test("new configuration clears previous edits and does not leak credentials on return", async ({
  page,
}) => {
  await openSettings(page);
  await editAllFields(page);
  await selectConfiguration(page, "新建模型配置");
  await expect(page.getByLabel("配置名称", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("默认模型", { exact: true })).toHaveValue("gpt-5-mini");
  await expect(page.locator("#agent-settings").getByRole("combobox").nth(1)).toHaveText("OpenAI");
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("自定义 Headers（JSON）", { exact: true })).toHaveValue("{}");
  await expect(page.getByRole("checkbox", { name: "作为默认模型", exact: true })).not.toBeChecked();
  await expect(page.locator('label[for="agent-api-key"]')).toHaveText("API key");
  await expect(page.locator('label[for="agent-auth-token"]')).toHaveText("Auth token");
  await expectClearedCredentials(page);
  await editAllFields(page);
  await selectConfiguration(page, configurations.anthropic.option);
  await expectConfiguration(page, "anthropic");
});

test("switching clears validation and submits only the selected configuration and current edits", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByLabel("配置名称", { exact: true }).fill("");
  await page.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(page.getByLabel("配置名称", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await selectConfiguration(page, configurations.anthropic.option);
  await expectConfiguration(page, "anthropic");
  await expect(page.getByLabel("配置名称", { exact: true })).toHaveAttribute("aria-invalid", "false");
  await page.getByLabel("配置名称", { exact: true }).fill("Synthetic edited Anthropic");
  await page.getByLabel("默认模型", { exact: true }).fill("synthetic-edited-model");
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

test("the first configuration keeps new defaults and submits an empty configuration id", async ({
  page,
}) => {
  await openSettings(page, true);
  await expect(page.getByRole("combobox", { name: "模型配置", exact: true })).toHaveText("新建模型配置");
  await expect(page.getByLabel("配置名称", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("默认模型", { exact: true })).toHaveValue("gpt-5-mini");
  await expect(page.getByRole("checkbox", { name: "作为默认模型", exact: true })).toBeChecked();
  await expectClearedCredentials(page);
  await page.getByLabel("配置名称", { exact: true }).fill("Synthetic first configuration");
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
