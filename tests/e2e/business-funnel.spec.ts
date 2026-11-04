import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`traceable independent funnel stages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/testing/business-funnel");
    await expect(page.getByRole("heading", { name: "业务漏斗" })).toBeVisible();
    await expect(page.getByText(/不计算转化率/)).toBeVisible();
    for (const id of ["products", "content", "enquiries", "quotes", "opportunities"])
      await expect(page.getByTestId(`funnel-count-${id}`)).toHaveText("1");
    const toggle = page.getByRole("button", { name: "查看记录与口径" }).first();
    await toggle.click();
    const link = page.getByRole("link", { name: /Synthetic test project · 已核验产品/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      /\/workspace\/synthetic-project\/records\/product\/synthetic-product/,
    );
    await toggle.click();
    await expect(link).not.toBeVisible();
    await toggle.click();
    await expect(link).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
test("empty and unavailable are distinct", async ({ page }) => {
  await page.goto("/testing/business-funnel?state=empty");
  await expect(page.getByTestId("funnel-count-opportunities")).toHaveText("0");
  await page.goto("/testing/business-funnel?state=unknown");
  await expect(page.getByTestId("funnel-count-opportunities")).toHaveText("暂不可用");
  await expect(page.getByTestId("funnel-count-products")).toHaveText("1");
  await page.goto("/testing/business-funnel?state=unavailable");
  await expect(page.getByRole("status")).toContainText("业务数据暂不可用");
  await expect(page.getByTestId("funnel-count-products")).toHaveCount(0);
});
