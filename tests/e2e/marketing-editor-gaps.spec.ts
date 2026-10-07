import { expect, type Page, test } from "@playwright/test";

const path = "/testing/project-workflow?record=content&state=content-generation";
const draft = {
  hook: "MOCK generated hook",
  body: "MOCK generated body",
  callToAction: "Discuss the MOCK workflow",
  hashtags: ["#MockTest"],
  visualInstruction: "MOCK text card",
};
const draftInputs = [
  ["开场句", "hook"],
  ["正文", "body"],
  ["行动号召", "callToAction"],
  ["标签", "hashtags"],
  ["视觉说明", "visualInstruction"],
] as const;

async function holdGeneration(page: Page, fail = false) {
  let attempts = 0;
  let started!: () => void;
  let release!: () => void;
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Only mock the Action response. Exercise the compiled production form and React transition;
  // no model request, business write, auth bypass or production data is involved.
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().headers()["next-action"]).toBeTruthy();
    expect(route.request().postData()).toContain("productId");
    started();
    await released;
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(
        fail && ++attempts === 1
          ? { status: "error", message: "MOCK generation failed" }
          : { status: "success", message: "MOCK draft generated", draft },
      )}\n`,
    });
  });
  await page.goto(path);
  await page.getByRole("button", { name: "生成可编辑初稿", exact: true }).click();
  await received;
  return async () => {
    release();
    await expect(page.getByRole("button", { name: "生成可编辑初稿", exact: true })).toBeEnabled();
  };
}

test("unchanged marketing form applies all generated fields", async ({ page }) => {
  const finish = await holdGeneration(page);
  await finish();
  for (const [label, key] of draftInputs) {
    const value = draft[key];
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(
      Array.isArray(value) ? value.join(" ") : value,
    );
  }
  await expect(page.getByText("MOCK draft generated", { exact: true })).toBeVisible();
});

for (const [label] of draftInputs) {
  test(`generation preserves edits made to ${label} while waiting`, async ({ page }) => {
    const finish = await holdGeneration(page);
    await page.getByLabel(label, { exact: true }).fill("MOCK newer manual edit");
    await finish();
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("MOCK newer manual edit");
    await expect(page.getByText(/生成期间.*已更改.*未覆盖/)).toBeVisible();
    // Reject the entire stale draft: do not mix old generated copy with the new edit.
    for (const [other] of draftInputs.filter(([candidate]) => candidate !== label)) {
      await expect(page.getByLabel(other, { exact: true })).toHaveValue("");
    }
  });
}

for (const [label, option] of [
  ["产品", "SYN-002 · MOCK second product"],
  ["允许引用的产品事实", "OE 编号"],
  ["内容类型", "工厂能力"],
] as const) {
  test(`generation rejects a draft after changing ${label}`, async ({ page }) => {
    const finish = await holdGeneration(page);
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await finish();
    await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(option);
    for (const [input] of draftInputs) {
      await expect(page.getByLabel(input, { exact: true })).toHaveValue("");
    }
    await expect(page.getByText(/生成期间.*已更改.*未覆盖/)).toBeVisible();
  });
}

for (const label of ["营销目标", "目标客户"] as const) {
  test(`generation rejects a draft after changing ${label}`, async ({ page }) => {
    const finish = await holdGeneration(page);
    await page.getByLabel(label, { exact: true }).fill("MOCK changed context");
    await finish();
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("MOCK changed context");
    await expect(page.getByLabel("正文", { exact: true })).toHaveValue("");
    await expect(page.getByText(/生成期间.*已更改.*未覆盖/)).toBeVisible();
  });
}

test("generation cannot queue content submission and failures leave edits available", async ({
  page,
}) => {
  const finish = await holdGeneration(page, true);
  await expect(page.getByRole("button", { name: "创建待审内容", exact: true })).toBeDisabled();
  await page.getByLabel("正文", { exact: true }).fill("MOCK retained draft");
  await finish();
  await expect(page.getByText("MOCK generation failed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("正文", { exact: true })).toHaveValue("MOCK retained draft");
  await expect(page.getByRole("button", { name: "创建待审内容", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "生成可编辑初稿", exact: true }).click();
  await expect(page.getByLabel("正文", { exact: true })).toHaveValue(draft.body);
  await expect(page.getByText("MOCK draft generated", { exact: true })).toBeVisible();
});

test("content submission prevents a concurrent generation request", async ({ page }) => {
  let release!: () => void;
  let started!: () => void;
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postData()).toContain("MOCK generated body");
    started();
    await held;
    await route.fulfill({
      contentType: "text/x-component",
      body: '0:{"a":"$@1","f":"","b":"synthetic"}\n1:{"status":"error","message":"MOCK save failed"}\n',
    });
  });
  await page.goto(path);
  for (const [label, key] of draftInputs) {
    const value = draft[key];
    await page
      .getByLabel(label, { exact: true })
      .fill(Array.isArray(value) ? value.join(" ") : value);
  }
  await page.getByRole("button", { name: "创建待审内容", exact: true }).click();
  await received;
  await expect(page.getByRole("button", { name: "生成可编辑初稿", exact: true })).toBeDisabled();
  release();
  await expect(page.getByText("MOCK save failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成可编辑初稿", exact: true })).toBeEnabled();
  await expect(page.getByLabel("正文", { exact: true })).toHaveValue(draft.body);
});

test("mixed product source coverage exposes each field needing original review", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?record=product&state=product-review");
  const source = page.getByRole("region", { name: "MOCK mixed source coverage", exact: true });
  await expect(
    source.getByText("MOCK source text: Verified clutch kit", { exact: true }),
  ).toBeVisible();
  const missingField = source.locator("div").filter({
    has: page.getByText("产品编号", { exact: true }),
  });
  await expect(
    missingField.getByText("未保留可直接展示的原文片段，请对照上方原件。", { exact: true }),
  ).toBeVisible();
});
