import { expect, test } from "@playwright/test";

test("desktop node selection updates the inspector without a drawer overlay", async ({ page }) => {
  await page.goto("/testing/project-canvas");
  await page.locator(".react-flow__node").click();

  const inspector = page.getByRole("complementary");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "产品资料" })).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="drawer-popup"]')).toHaveCount(0);
});

test("mobile node selection opens the drawer overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/project-canvas");
  await page.locator(".react-flow__node").click();

  await expect(page.locator('[data-slot="drawer-popup"]')).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
});
