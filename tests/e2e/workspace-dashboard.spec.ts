import { expect, test } from "@playwright/test";

test("workspace prioritizes tasks and pipeline without a canvas", async ({ page }) => {
  await page.goto("/testing/workspace-dashboard");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByText("先处理下一动作，再进入对应项目步骤。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "待审批" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "到期跟进" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目 / 线索 Pipeline" })).toBeVisible();
  await expect(page.getByText("来源营销项目：Synthetic launch")).toBeVisible();
  const videoTask = page.getByRole("link").filter({ hasText: "营销视频等待成片审核" }).first();
  await expect(videoTask).toHaveAttribute("href", "/workspace/00000000-0000-4000-8000-000000000701/video?item=00000000-0000-4000-8000-000000000713");
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "项目画布" })).toHaveCount(0);
});

test("unassigned inbound offers explicit create and link decisions without customer identity", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/workspace-dashboard");
  await expect(page.getByText("入站消息 A1B2C3D4")).toBeVisible();
  const createTarget = await page.getByRole("button", { name: "新建销售项目" }).boundingBox();
  expect(createTarget?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "新建销售项目" }).click();
  await expect(page.getByRole("dialog").getByText("不会暴露客户姓名或账号", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "关联现有项目" }).click();
  await expect(page.getByRole("dialog").getByText("只显示你有权编辑的销售项目", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "销售项目" }).click();
  await expect(page.getByRole("option", { name: "Synthetic distributor" })).toBeVisible();
});

test("project workspace exposes guided steps, records and a right detail region", async ({ page }) => {
  await page.goto("/testing/project-workspace");
  await expect(page.getByRole("navigation", { name: "项目阶段" })).toBeVisible();
  await expect(page.getByRole("link", { name: /步骤 1 产品事实/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "待处理事项" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "产品事实详情与审批" })).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await page.getByRole("link", { name: /步骤 2 内容/ }).click();
  await expect(page).toHaveURL(/panel=content/);
  await expect(page).not.toHaveURL(/view=records/);
  await expect(page.getByRole("complementary", { name: "内容详情与审批" })).toBeVisible();
  await page.getByRole("button", { name: "成员 2" }).click();
  await expect(page.getByText("成员关系独立于项目创建者", { exact: false })).toBeVisible();
  await expect(page.getByText("Synthetic Viewer")).toBeVisible();
  await expect(page.getByLabel("项目角色")).toBeVisible();
  await page.getByRole("button", { name: "移除成员 Synthetic Viewer" }).click();
  const removal = page.getByRole("alertdialog", { name: "移除项目成员？" });
  await expect(removal.getByText("将立即失去该项目的查看和编辑权限", { exact: false })).toBeVisible();
  await expect(removal.getByRole("button", { name: "保留成员" })).toBeVisible();
  await expect(removal.getByRole("button", { name: "移除 Synthetic Viewer" })).toBeVisible();
  await removal.getByRole("button", { name: "保留成员" }).click();
  await expect(removal).toHaveCount(0);
});

test("video production has a dedicated editor route", async ({ page }) => {
  await page.goto("/testing/video-workspace");
  await expect(page.getByRole("heading", { name: "视频编辑器" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "素材、预览与时间线" })).toBeVisible();
  await expect(page.getByText("复制其他项目剪辑")).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
});

test("project flow remains an optional read-only diagnostic view", async ({ page }) => {
  await page.goto("/testing/project-canvas?view=flow");
  await expect(page.getByText("只读流程概览")).toBeVisible();
  await expect(page.getByRole("button", { name: "整理画布" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回项目工作区" })).toHaveAttribute("href", "/workspace/00000000-0000-4000-8000-000000000202");
  await expect(page.locator(".react-flow")).toBeVisible();
});
