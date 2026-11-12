import { expect, test } from "@playwright/test";

const pagePath = (state: string) =>
  `/testing/project-workflow?kind=sales&record=quotation&state=${state}`;

for (const state of ["quote-needs-both", "quote-needs-product", "quote-needs-rfq"]) {
  test(`${state} explains each missing requirement without offering premature quotation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pagePath(state));
    await expect(page.locator("form#quotation-new")).toHaveCount(0);
    const alert = page.getByRole("region", { name: "业务记录", exact: true }).getByRole("alert");
    if (state !== "quote-needs-product") {
      await expect(alert).toContainText("客户需求确认完整后");
      await expect(page.getByRole("link", { name: "查看客户需求", exact: true })).toHaveAttribute(
        "href",
        "/workspace/customers?project=00000000-0000-4000-8000-000000000203",
      );
    } else {
      await expect(page.getByRole("link", { name: "查看客户需求", exact: true })).toHaveCount(0);
    }
    if (state !== "quote-needs-rfq") {
      await expect(alert).toContainText("关联已核实产品");
      await expect(page.getByText("尚无可添加的已核实产品", { exact: true })).toBeVisible();
    } else {
      await expect(alert).not.toContainText("关联已核实产品");
    }
    await expect(page.getByRole("link", { name: "前往产品资料库", exact: true })).toHaveAttribute(
      "href",
      "/workspace/products",
    );
    await expect(page.getByRole("button", { name: "添加到当前项目", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
}

test("available verified candidates retain the association action", async ({ page }) => {
  await page.goto(pagePath("quote-product-candidate"));
  await expect(page.getByRole("combobox", { name: "已核实产品", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加到当前项目", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "前往产品资料库", exact: true })).toHaveCount(0);
});

test("all candidates already linked does not claim no verified products exist", async ({
  page,
}) => {
  await page.goto(pagePath("quote-products-linked"));
  await expect(page.getByText("暂无其他可添加产品", { exact: true })).toBeVisible();
  await expect(page.getByText("已关联产品可继续用于报价。", { exact: false })).toBeVisible();
  await expect(page.locator("form#quotation-new")).toBeVisible();
  await expect(page.getByText("尚无可添加的已核实产品", { exact: true })).toHaveCount(0);
});
