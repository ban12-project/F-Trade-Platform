import { expect, test } from "@playwright/test";

test("workspace prioritizes tasks and pipeline without a canvas", async ({ page }) => {
  await page.goto("/testing/workspace-dashboard");
  await expect(page.getByRole("heading", { name: "今日任务" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我可处理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目概况" })).toBeVisible();
  await expect(page.getByRole("link").filter({ hasText: "批准内容等待发布" })).toHaveCount(1);
  await page.getByRole("link", { name: /等待他人/ }).click();
  await expect(page.getByRole("link").filter({ hasText: "等待审核者核实产品" })).toBeVisible();
  await expect(page.getByRole("link").filter({ hasText: "批准内容等待发布" })).toHaveCount(0);
  await page.goBack();
  const videoTask = page.getByRole("link").filter({ hasText: "营销视频等待成片审核" }).first();
  await expect(videoTask).toHaveAttribute(
    "href",
    "/workspace/00000000-0000-4000-8000-000000000701/video?item=00000000-0000-4000-8000-000000000713",
  );
  await expect(page.getByRole("link", { name: "项目画布" })).toHaveCount(0);
});

test("unassigned inbound offers explicit create and link decisions without customer identity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/workspace-dashboard");
  await expect(page.getByText("入站消息 A1B2C3D4")).toBeVisible();
  const createTarget = await page.getByRole("button", { name: "新建销售项目" }).boundingBox();
  expect(createTarget?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "新建销售项目" }).click();
  await expect(
    page.getByRole("dialog").getByText("不会暴露客户姓名或账号", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "关联现有项目" }).click();
  await expect(
    page.getByRole("dialog").getByText("只显示你有权编辑的销售项目", { exact: false }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "销售项目" }).click();
  await expect(page.getByRole("option", { name: "Synthetic distributor" })).toBeVisible();
});

test("project workspace exposes categories, records and a primary detail region", async ({
  page,
}) => {
  await page.goto("/testing/project-workspace");
  await expect(page.getByRole("navigation", { name: "项目栏目" })).toBeVisible();
  await expect(page.getByRole("link", { name: "产品事实", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "待处理事项" })).toBeVisible();
  await expect(page.getByRole("region", { name: "产品事实详情与审批" })).toBeVisible();
  await page.getByRole("link", { name: /^内容$/ }).click();
  await expect(page).toHaveURL(/panel=content/);
  await expect(page).not.toHaveURL(/view=records/);
  await expect(page.getByRole("region", { name: "内容详情与审批" })).toBeVisible();
  await page.getByRole("button", { name: "成员 2" }).click();
  await expect(page.getByText("成员关系独立于项目创建者", { exact: false })).toBeVisible();
  await expect(page.getByText("Synthetic Viewer")).toBeVisible();
  await expect(page.getByLabel("项目角色")).toBeVisible();
  await page.getByRole("button", { name: "移除成员 Synthetic Viewer" }).click();
  const removal = page.getByRole("alertdialog", { name: "移除项目成员？" });
  await expect(
    removal.getByText("将立即失去该项目的查看和编辑权限", { exact: false }),
  ).toBeVisible();
  await expect(removal.getByRole("button", { name: "保留成员" })).toBeVisible();
  await expect(removal.getByRole("button", { name: "移除 Synthetic Viewer" })).toBeVisible();
  await removal.getByRole("button", { name: "保留成员" }).click();
  await expect(removal).toHaveCount(0);
});

test("video production has a dedicated editor route", async ({ page }) => {
  await page.goto("/testing/video-workspace");
  await expect(page.getByRole("heading", { name: "视频编辑器" })).toBeVisible();
  await expect(page.getByLabel("成片时长（秒）")).toHaveCount(2);
  await expect(page.getByText("复制其他项目剪辑")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回内容与发布" })).toBeVisible();
});

for (const empty of [false, true]) {
  test(`mobile first viewport has a usable start action with ${empty ? "no records" : "existing tasks"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/testing/workspace-dashboard${empty ? "?empty=1" : ""}`);
    const start = page.getByRole("button", { name: "开始新工作", exact: true });
    await expect(start).toBeEnabled();
    const bounds = await start.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.y + bounds!.height).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await start.click();
    await expect(page.getByRole("dialog", { name: "开始新工作" })).toBeVisible();
    if (empty) await expect(page.getByLabel("项目名称")).toBeVisible();
    else {
      await expect(page.getByLabel("归属项目")).toHaveValue("00000000-0000-4000-8000-000000000701");
      await expect(page.getByLabel("项目名称")).toHaveCount(0);
    }
  });
}
