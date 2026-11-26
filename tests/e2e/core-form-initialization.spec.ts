import { expect, test } from "@playwright/test";

const scenarios = [
  {
    name: "RFQ",
    path: "/testing/project-workflow?kind=sales&record=rfq-new",
    form: "form#create-rfq",
    label: "客户名称",
    choice: "产品类型",
    choiceRole: "combobox" as const,
    option: "离合器套件",
  },
  {
    name: "manual product",
    path: "/testing/product-draft-initialization",
    form: 'form[id$="-create-product"]:visible',
    label: "产品名称",
    choice: "产品类型",
    choiceRole: "combobox" as const,
    option: "离合器套件",
  },
  {
    name: "product review",
    path: "/testing/project-workflow?record=product&state=product-review",
    form: 'form[id$="-product-review"]',
    label: /^审核备注(?:（必填）)?$/,
    choice: "决定",
    choiceRole: "radio" as const,
    option: "退回产品信息",
  },
];

for (const scenario of scenarios) {
  test(`${scenario.name} waits for initialization and retains its first edit`, async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
      await held;
      await route.continue();
    });
    const form = page.locator(scenario.form);
    const input = form.getByRole("textbox", { name: scenario.label, exact: true });
    const choice =
      scenario.choiceRole === "radio"
        ? form
            .getByRole("radiogroup", { name: scenario.choice, exact: true })
            .getByRole("radio", { name: scenario.option, exact: true })
        : form.getByRole("combobox", { name: scenario.choice, exact: true });
    try {
      await page.goto(scenario.path, { waitUntil: "commit" });
      await expect(input).toBeVisible();
      await expect(input).toBeDisabled();
      await expect(choice).toBeDisabled();
      await expect(form).toHaveAttribute("aria-busy", "true");
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(input).toBeEnabled();
    await input.fill(`SYNTHETIC first ${scenario.name} edit`);
    if (scenario.choiceRole === "radio") {
      await choice.click();
      await expect(choice).toBeChecked();
    } else {
      await choice.click();
      await page.getByRole("option", { name: scenario.option, exact: true }).click();
      await expect(choice).toContainText(scenario.option);
    }
    await expect(input).toHaveValue(`SYNTHETIC first ${scenario.name} edit`);
    await expect(form).toHaveAttribute("aria-busy", "false");
  });
}

test("RFQ suggestion work still permits manual edits while save is unavailable", async ({
  page,
}) => {
  await page.goto(scenarios[0].path);
  const form = page.locator("form#create-rfq");
  await form.getByRole("combobox", { name: "来源客户会话（可选）" }).click();
  await page.getByRole("option", { name: /SYNTHETIC buyer requests 500 clutch kits/ }).click();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    await held;
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: "error", message: "SYNTHETIC suggestion unavailable" })}\n`,
    });
  });
  const input = form.getByRole("textbox", { name: "客户名称", exact: true });
  const save = page.getByRole("button", { name: "保存询盘", exact: true });
  try {
    await form.getByRole("button", { name: "从客户消息整理建议", exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await expect(save).toBeDisabled();
    await expect(input).toBeEnabled();
    await input.fill("SYNTHETIC edit during suggestion");
  } finally {
    release();
  }
  await expect(page.getByText("SYNTHETIC suggestion unavailable", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("SYNTHETIC edit during suggestion");
  await expect(save).toBeEnabled();
});

for (const kind of ["RFQ", "product review"] as const) {
  test(`${kind} locks submitted values and restores editing after a denied action`, async ({
    page,
  }) => {
    const scenario = scenarios.find((item) => item.name === kind);
    if (!scenario) throw new Error(`Missing scenario: ${kind}`);
    await page.goto(scenario.path);
    const form = page.locator(scenario.form);
    const input = form.getByRole("textbox", { name: scenario.label, exact: true });
    const choice =
      scenario.choiceRole === "radio"
        ? form
            .getByRole("radiogroup", { name: scenario.choice, exact: true })
            .getByRole("radio", { name: scenario.option, exact: true })
        : form.getByRole("combobox", { name: scenario.choice, exact: true });
    await input.fill(`SYNTHETIC retained ${kind} input`);
    if (scenario.choiceRole === "radio") {
      await choice.click();
    } else {
      await choice.click();
      await page.getByRole("option", { name: scenario.option, exact: true }).click();
    }
    const evidence = form.getByRole("combobox", {
      name: kind === "RFQ" ? "客户需求来源" : "审核依据",
      exact: true,
    });
    await evidence.click();
    await page
      .getByRole("option", {
        name: kind === "RFQ" ? /合成审核记录.pdf/ : /Synthetic review evidence/,
      })
      .click();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts: string[] = [];
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts.push(route.request().postData() ?? "");
      await held;
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: "error", message: "SYNTHETIC save denied" })}\n`,
      });
    });
    const save = page.getByRole("button", { name: kind === "RFQ" ? /保存询盘/ : /退回产品信息/ });
    try {
      await save.click();
      await expect.poll(() => posts.length).toBe(1);
      await expect(form).toHaveAttribute("aria-busy", "true");
      for (const control of [input, choice, evidence, save]) await expect(control).toBeDisabled();
      expect(posts[0]).toContain(`SYNTHETIC retained ${kind} input`);
    } finally {
      release();
    }
    await expect(page.getByText("SYNTHETIC save denied", { exact: true })).toBeVisible();
    await expect(form).toHaveAttribute("aria-busy", "false");
    await expect(save).toBeEnabled();
    await expect(input).toHaveValue(`SYNTHETIC retained ${kind} input`);
    if (scenario.choiceRole === "radio") await expect(choice).toBeChecked();
    else await expect(choice).toContainText(scenario.option);
    expect(posts).toHaveLength(1);
  });
}
