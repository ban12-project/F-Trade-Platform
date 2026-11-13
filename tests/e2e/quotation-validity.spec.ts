import { expect, test } from "@playwright/test";

for (const revision of [false, true]) {
  test(`quotation date validation retains ${revision ? "revised" : "new"} terms without writes`, async ({
    page,
  }) => {
    await page.goto(
      `/testing/project-workflow?kind=sales&record=quotation${revision ? "&state=quote-revision" : ""}`,
    );
    const form = page.locator('form[id^="quotation-"]');
    await expect(form.getByLabel("有效期起算日", { exact: true })).toBeEmpty();
    await expect(form.getByLabel("有效期适用时区", { exact: true })).toBeEmpty();
    await form.getByLabel("单价", { exact: true }).fill("12.50");
    await form.getByLabel("最小起订量（MOQ）", { exact: true }).fill("10");
    await form.getByLabel("交期（天）", { exact: true }).fill("3");
    await form.getByLabel("付款条件", { exact: true }).fill("SYNTHETIC terms");
    await form.getByRole("combobox", { name: "报价依据", exact: true }).click();
    await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
    await form.getByLabel("有效期起算日", { exact: true }).fill("2026-03-07");
    await form.getByLabel("有效期截止日", { exact: true }).fill("2026-03-06");
    await form.getByLabel("有效期适用时区", { exact: true }).fill("Invalid/Zone");
    let posts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") posts++;
    });
    await page
      .getByRole("button", {
        name: revision ? "提交修订并再次送审" : "创建报价并提交审核",
        exact: true,
      })
      .click();
    await expect(form.getByText("截止日期不能早于起算日期。", { exact: true })).toBeVisible();
    await expect(form.getByText("请选择有效的 IANA 时区。", { exact: true })).toBeVisible();
    await form.getByLabel("有效期截止日", { exact: true }).fill("2026-03-09");
    await form.getByLabel("有效期适用时区", { exact: true }).fill("America/New_York");
    await page
      .getByRole("button", {
        name: revision ? "提交修订并再次送审" : "创建报价并提交审核",
        exact: true,
      })
      .click();
    await expect(
      form.getByText("有效天数须与起止日期一致，包含首尾日期。", { exact: true }),
    ).toBeVisible();
    await form.getByLabel("有效期（天）", { exact: true }).fill("3");
    await expect(form.getByLabel("有效期（天）", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    await expect(form.getByLabel("付款条件", { exact: true })).toHaveValue("SYNTHETIC terms");
    expect(posts).toBe(0);
  });
}

test("approved calendar dates copy exactly without recording a send", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  await page.goto("/testing/project-workflow?kind=sales&record=quotation&state=quote-dated");
  const text = page.getByRole("textbox", { name: "客户报价文案（英文，只读）" });
  await expect(text).toHaveValue(/Valid from: 2026-03-07/);
  await expect(text).toHaveValue(/Valid through: 2026-03-09 \(inclusive\)/);
  await expect(text).toHaveValue(/Validity timezone: America\/New_York/);
  await page.getByRole("button", { name: "复制客户报价文案" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已复制。尚未发送" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await text.inputValue());
  expect(posts).toBe(0);
});
