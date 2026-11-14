import { expect, test } from "@playwright/test";

for (const revision of [false, true]) {
  test(`${revision ? "revised" : "new"} quotation rejects lossy numbers without altering the human draft`, async ({
    page,
  }) => {
    await page.goto(
      `/testing/project-workflow?kind=sales&record=quotation${revision ? "&state=quote-revision" : ""}`,
    );
    const form = page.locator('form[id^="quotation-"]');
    const inputs = [
      { label: "单价", invalid: "9999999999999.9999", valid: "12.5000" },
      { label: "最小起订量（MOQ）", invalid: "9007199254740993", valid: "10" },
      { label: "交期（天）", invalid: "9".repeat(400), valid: "0" },
      { label: "有效期（天）", invalid: "9007199254740992", valid: "30" },
    ];
    await form.getByLabel("付款条件", { exact: true }).fill("SYNTHETIC manual terms");
    await form.getByRole("combobox", { name: "报价依据", exact: true }).click();
    await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
    for (const { label, invalid } of inputs)
      await form.getByLabel(label, { exact: true }).fill(invalid);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    await page
      .getByRole("button", {
        name: revision ? "提交修订并再次送审" : "创建报价并提交审核",
        exact: true,
      })
      .click();
    await expect(
      form.getByText("单价超出可准确保存的范围，请核对金额；系统不会自动四舍五入。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      form.getByText("交期超出可准确保存的整数范围，请核对。", { exact: true }),
    ).toBeVisible();
    await expect(
      form.getByText("数值超出可准确保存的整数范围，请核对。", { exact: true }),
    ).toHaveCount(2);
    for (const { label, invalid, valid } of inputs) {
      const input = form.getByLabel(label, { exact: true });
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveValue(invalid);
      await input.fill(valid);
      await expect(input).toHaveAttribute("aria-invalid", "false");
    }
    await expect(form.getByLabel("付款条件", { exact: true })).toHaveValue(
      "SYNTHETIC manual terms",
    );
    expect(posts).toEqual([]);
  });
}

for (const revision of [false, true]) {
  test(`${revision ? "revised" : "new"} quotation waits for initialization and preserves the first edit`, async ({
    page,
  }) => {
    let release = () => {};
    const scriptsReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
      await scriptsReady;
      await route.continue();
    });
    const form = page.locator('form[id^="quotation-"]');
    const terms = form.getByLabel("付款条件", { exact: true });
    const submit = page.getByRole("button", {
      name: revision ? "提交修订并再次送审" : "创建报价并提交审核",
      exact: true,
    });
    try {
      await page.goto(
        `/testing/project-workflow?kind=sales&record=quotation${revision ? "&state=quote-revision" : ""}`,
        { waitUntil: "commit" },
      );
      await expect(terms).toBeVisible();
      await expect(terms).toBeDisabled();
      await expect(form.getByLabel("单价", { exact: true })).toBeDisabled();
      await expect(form.getByRole("combobox", { name: "报价产品", exact: true })).toBeDisabled();
      await expect(submit).toBeDisabled();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(terms).toBeEnabled();
    await expect(terms).toHaveValue(revision ? "MOCK terms; synthetic only" : "");
    await terms.fill("SYNTHETIC first manual edit");
    await form.getByLabel("单价", { exact: true }).fill("12.50");
    await expect(terms).toHaveValue("SYNTHETIC first manual edit");
    await expect(submit).toBeEnabled();
  });
}

test("quotation submission locks commercial terms and rejection restores the same draft", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?kind=sales&record=quotation&state=quote-revision");
  const form = page.locator('form[id^="quotation-"]');
  const terms = form.getByLabel("付款条件", { exact: true });
  await terms.fill("SYNTHETIC submitted terms");
  await form.getByRole("combobox", { name: "报价依据", exact: true }).click();
  await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
  let release = () => {};
  let requested = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() === "POST") {
      requested = true;
      await held;
    }
    await route.continue();
  });
  const submit = page.locator('button[type="submit"][form^="quotation-"]');
  try {
    await submit.click();
    await expect.poll(() => requested).toBe(true);
    await expect(terms).toBeDisabled();
    await expect(form.getByLabel("单价", { exact: true })).toBeDisabled();
    await expect(form.getByRole("combobox", { name: "报价产品", exact: true })).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(form).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
  }
  // The fixture has no signed session; the real Action rejects without a business write.
  await expect(submit).toBeEnabled();
  await expect(terms).toBeEnabled();
  await expect(terms).toHaveValue("SYNTHETIC submitted terms");
  await expect(form).toHaveAttribute("aria-busy", "false");
});
