import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";

test("navigates to the testing page", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "查看测试页面" }).click();

  await expect(page).toHaveURL(/\/testing$/);
  await expect(page.getByRole("heading", { name: "Playwright 测试基线" })).toBeVisible();
});

test("commits the prefetched testing route instantly", async ({ page }) => {
  await page.goto("/");

  const testingLink = page.getByRole("link", { name: "查看测试页面" });
  await expect(testingLink).toBeVisible();

  await instant(page, async () => {
    await testingLink.click();
    await expect(page.getByRole("heading", { name: "Playwright 测试基线" })).toBeVisible();
  });
});
