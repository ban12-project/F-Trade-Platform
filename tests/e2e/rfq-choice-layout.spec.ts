import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1280]) {
  test(`RFQ choices keep maximum-length requests readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/testing/project-workflow?kind=sales&record=rfq-choices");
    const list = page.getByRole("region", { name: "业务记录", exact: true }).getByRole("list");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    const choices = list.getByRole("link");
    const longChoice = choices.nth(0);
    await expect(longChoice).toContainText("SYNTHETIC".padEnd(240, "X"));
    await expect(longChoice).toContainText("SYNTHETIC".padEnd(240, "Y"));
    await expect(choices.nth(1)).toContainText("客户需求");
    await expect(choices.nth(1)).toContainText("数量：待补充");
    await expect(choices.nth(1)).toContainText("目的地：待补充");
    await expect(page.getByText("不代表产品适配已核实", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    for (const choice of await choices.all()) {
      const geometry = await choice.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          childrenInside: [...element.querySelectorAll(":scope > span")].every((child) => {
            const rect = child.getBoundingClientRect();
            return rect.left >= bounds.left && rect.right <= bounds.right;
          }),
        };
      });
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
      expect(geometry.childrenInside).toBe(true);
      await choice.focus();
      await expect(choice).toBeFocused();
    }
  });
}
