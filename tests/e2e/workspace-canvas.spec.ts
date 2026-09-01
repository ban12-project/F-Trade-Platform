import { expect, test } from "@playwright/test";

test("empty project canvas has one creation entry and centers its dialog", async ({ page }) => {
  await page.goto("/testing/workspace-canvas");

  const canvas = page.getByRole("main", { name: "项目总画布" });
  await expect(canvas).toBeVisible();
  await expect(page.getByText("从一张项目画布开始")).toHaveCount(0);
  await expect(page.getByText("Synthetic project", { exact: true })).toHaveCount(0);

  const createProject = page.getByRole("button", { name: "新建", exact: true });
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

  await dialog.getByLabel("项目名称").fill("Synthetic canvas project");
  await dialog.getByRole("button", { name: "创建并打开画布" }).click();
  await expect(page.getByText(/useActionState.*transition/)).toHaveCount(0);
  await expect(dialog.getByText("无权访问项目工作区。", { exact: true })).toBeVisible();
});

test("desktop project switcher renders only a sheet overlay", async ({ page }) => {
  await page.goto("/testing/workspace-canvas");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
  await expect(page.getByText("Synthetic project", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
});

test("mobile project switcher renders only a drawer overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/workspace-canvas");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await expect(page.locator('[data-slot="drawer-popup"]')).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
});

test("desktop workspace settings open in a sheet and keep video generation out", async ({ page }) => {
  await page.goto("/testing/workspace-canvas");
  await page.getByRole("button", { name: "工具", exact: true }).click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "工具与账号" })).toBeVisible();
  await expect(sheet.getByText("视频生成仍未启用")).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "Agent" })).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "团队" })).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "安全" })).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "渠道" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /生成视频|视频供应商|重试生成/ })).toHaveCount(0);
  await sheet.getByRole("tab", { name: "Agent" }).click();
  const modelConfig = sheet.getByRole("combobox", { name: "模型配置" });
  await expect(modelConfig).toContainText("日常产品导入（默认）");
  await modelConfig.click();
  await expect(page.getByRole("option", { name: "复杂目录识别" })).toBeVisible();
  await expect(page.getByRole("option", { name: "新建模型配置" })).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
});

test("mobile workspace settings open in a drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/workspace-canvas");
  await page.getByRole("button", { name: "工具", exact: true }).click();

  await expect(page.locator('[data-slot="drawer-popup"]')).toBeVisible();
  await expect(page.getByText("视频生成仍未启用")).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
});

test("cross-project tasks expose an exact project node deep link", async ({ page }) => {
  await page.goto("/testing/workspace-canvas");
  await page.getByRole("button", { name: /待办/ }).click();
  const task = page.getByRole("button", { name: /Synthetic content review/ });
  await expect(task).toBeVisible();
  await expect(task).toHaveAttribute("data-target", "/workspace/00000000-0000-4000-8000-000000000197?panel=content&view=records&item=00000000-0000-4000-8000-000000000198");
});
