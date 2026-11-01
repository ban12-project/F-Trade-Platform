import { expect, test } from "@playwright/test";

for (const query of ["", "?enabled=1"]) {
  test(`retired managed creation stays absent ${query || "by default"}`, async ({ page }) => {
    await page.goto(`/testing/browser-sandbox-registration${query}`);
    await expect(page.getByRole("region", { name: "合成生命周期状态" })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建托管节点" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "托管节点名称" })).toHaveCount(0);
  });
}
