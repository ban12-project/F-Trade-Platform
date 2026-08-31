import { expect, test } from "@playwright/test";

test("empty project canvas has one creation entry and centers its dialog", async ({ page }) => {
  await page.goto("/testing/workspace-canvas");

  const canvas = page.getByRole("main", { name: "项目总画布" });
  await expect(canvas).toBeVisible();
  await expect(page.getByText("从一张项目画布开始")).toHaveCount(0);

  const createProject = page.getByRole("button", { name: "新建项目" });
  await expect(createProject).toHaveCount(1);
  await createProject.click();

  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "新建项目" })).toBeVisible();

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((box!.x + box!.width / 2) - viewport!.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs((box!.y + box!.height / 2) - viewport!.height / 2)).toBeLessThanOrEqual(2);
});
