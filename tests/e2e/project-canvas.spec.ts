import { expect, test } from "@playwright/test";

test("desktop node selection updates the inspector without a drawer overlay", async ({ page }) => {
  await page.goto("/testing/project-canvas");
  await page.locator(".react-flow__node").first().click();

  const inspector = page.getByRole("complementary");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "产品资料" })).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="drawer-popup"]')).toHaveCount(0);
});

test("mobile node selection opens the drawer overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/project-canvas");
  await page.locator(".react-flow__node").first().click();

  await expect(page.locator('[data-slot="drawer-popup"]')).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
});

test("marketing video node opens the viewport-bound editor and reflects URL state", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/testing/project-canvas");
  await page.getByText("营销视频", { exact: true }).click();

  await expect(page).toHaveURL(/panel=video/);
  const inspector = page.getByRole("complementary");
  await expect(inspector.getByText("最长 15 秒")).toBeVisible();
  await expect(inspector.getByText("8.0 / 15 秒")).toBeVisible();
  const box = await inspector.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(672);
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("marketing video editor blocks a draft longer than 15 seconds in the browser", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=video");
  const durations = page.getByLabel("成片时长（秒）");
  await durations.nth(0).fill("10");
  await durations.nth(1).fill("10");

  await expect(page.getByText("视频过长")).toBeVisible();
  await expect(page.getByRole("button", { name: "合成预览" })).toBeDisabled();
});

test("marketing video panel exposes upload and post-render review without generation controls", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=video");
  await page.getByRole("button", { name: "新建" }).click();

  await expect(page.getByLabel("素材（1–3 个）")).toHaveAttribute("accept", /video\/mp4/);
  await expect(page.getByLabel("素材权利证据")).toBeVisible();
  await expect(page.getByText("不会调用视频生成模型")).toBeVisible();
  await expect(page.getByRole("button", { name: /生成视频|模型配置|供应商/ })).toHaveCount(0);

  await page.goto("/testing/project-canvas?panel=video&state=review");
  await expect(page.getByText("私有预览")).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("src", /\/api\/video-preview\/asset-rendered-preview-001$/);
  await expect(page.getByRole("button", { name: "退回修改" })).toBeVisible();
  await expect(page.getByRole("button", { name: "通过成片" })).toBeVisible();
});
