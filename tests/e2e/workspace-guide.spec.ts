import { expect, test } from "@playwright/test";

const root = "/testing/workspace-navigation";

test("guide explains the current publication composer without changing selections or submitting", async ({
  page,
}) => {
  await page.goto("/testing/publication-batch");
  await page.waitForLoadState("networkidle");
  const account = page.getByRole("checkbox", { name: /Facebook · Alpha/ });
  await account.check();
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
  });
  const trigger = page.getByRole("button", { name: "使用引导", exact: true });
  await trigger.click();
  const popover = page.locator(".workspace-guide-popover");
  await popover.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(popover.getByText("审核通过后安排发布", { exact: true })).toBeVisible();
  await expect(page.locator(".driver-active-element")).toHaveAttribute(
    "data-publication-composer",
    "true",
  );
  await expect(popover).toContainText("逐个选择本次账号");
  await expect(popover).toContainText("已批准不代表已发布");
  await popover.getByRole("button", { name: "下一步", exact: true }).click();
  await popover.getByRole("button", { name: "开始操作", exact: true }).click();
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(account).toBeChecked();
  expect(writes).toBe(0);
});

test("guide explains visible navigation without submitting or changing a draft", async ({
  page,
}) => {
  await page.goto(root);
  await page.getByLabel("测试草稿").fill("Keep this unsaved draft");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") writes += 1;
  });
  const trigger = page.getByRole("button", { name: "使用引导", exact: true });
  await trigger.click();
  const popover = page.locator(".workspace-guide-popover");
  await expect(popover.getByText("从资料到有效商机", { exact: true })).toBeVisible();
  await popover.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(popover.getByText("先选工作，再选项目", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel("测试草稿")).toHaveValue("Keep this unsaved draft");
  expect(writes).toBe(0);
  await trigger.click();
  await expect(popover.getByText("从资料到有效商机", { exact: true })).toBeVisible();
  await popover.getByRole("button", { name: "退出引导", exact: true }).click();
  await page.getByRole("link", { name: /Synthetic persistent workspace/ }).click();
  await expect(page.getByRole("alertdialog", { name: "放弃未保存的修改？" })).toBeVisible();
});

test("mobile guide uses the visible menu and can be completed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(root);
  await page.getByRole("button", { name: "使用引导", exact: true }).click();
  const popover = page.locator(".workspace-guide-popover");
  await popover.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(popover.getByText("打开工作区导航", { exact: true })).toBeVisible();
  await expect(page.locator(".driver-active-element")).toHaveAttribute("aria-label", "打开导航");
  await popover.getByRole("button", { name: "下一步", exact: true }).click();
  await popover.getByRole("button", { name: "开始操作", exact: true }).click();
  await expect(popover).toHaveCount(0);
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await expect(page.getByRole("link", { name: "产品资料", exact: true })).toBeVisible();
});

test.describe("follow-up reminders", () => {
  test.use({ timezoneId: "America/New_York", viewport: { width: 390, height: 844 } });
  test("guide explains planning and repeated times without changing edits", async ({ page }) => {
    await page.goto("/testing/project-workflow?kind=sales&record=lead&state=lead-guide");
    const draft = page.getByLabel("待人工发送内容", { exact: true });
    const date = page.getByLabel("下次跟进时间（可选）", { exact: true });
    const occurrence = page.getByRole("combobox", { name: "重复时间选择", exact: true });
    await draft.fill("SYNTHETIC guide keeps this reply");
    await date.fill("2027-11-07T01:30");
    await occurrence.selectOption("2027-11-07T06:30:00.000Z");
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") writes++;
    });
    const trigger = page.getByRole("button", { name: "使用引导", exact: true });
    await trigger.click();
    const popover = page.locator(".workspace-guide-popover");
    await popover.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(popover.getByText("按客户反馈制定跟进", { exact: true })).toBeVisible();
    await expect(popover).toContainText("保存计划不会发送消息，也不会清空待发送草稿");
    await popover.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(popover.getByText("用当前设备时区设置提醒", { exact: true })).toBeVisible();
    await expect(page.locator(".driver-active-element")).toHaveAttribute("name", "nextFollowUpAt");
    await expect(popover).toContainText("清空后保存可取消提醒");
    await expect(popover).toContainText("重复时间需选择第一次或第二次");
    const bounds = await popover.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(draft).toHaveValue("SYNTHETIC guide keeps this reply");
    await expect(date).toHaveValue("2027-11-07T01:30");
    await expect(occurrence).toHaveValue("2027-11-07T06:30:00.000Z");
    expect(writes).toBe(0);
  });
});

test("mobile dashboard guide explains snapshot refresh without reading or writing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/workspace-dashboard?offline=1&view=scheduled");
  await page.waitForLoadState("networkidle");
  const before = await page.locator("header time").getAttribute("datetime");
  let refreshes = 0;
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
    if (
      request.url().includes("/testing/workspace-dashboard") &&
      request.headers().rsc === "1" &&
      !request.headers()["next-router-prefetch"]
    )
      refreshes++;
  });
  const trigger = page.getByRole("button", { name: "使用引导", exact: true });
  await trigger.click();
  const popover = page.locator(".workspace-guide-popover");
  await popover.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(popover.getByText("打开工作区导航", { exact: true })).toBeVisible();
  await popover.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(popover.getByText("确认任务列表是否最新", { exact: true })).toBeVisible();
  await expect(page.locator(".driver-active-element")).toHaveAttribute(
    "data-guide",
    "task-refresh",
  );
  await expect(popover).toContainText("不会自动更新");
  await expect(popover).toContainText("保留当前筛选");
  await expect(popover).toContainText("不会发送消息或提交审核");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/offline=1&view=scheduled$/);
  await expect(page.locator("header time")).toHaveAttribute("datetime", before ?? "");
  await expect(
    page.getByRole("link").filter({ hasText: "下一动作：收集样品需求，交由人工确认。" }),
  ).toBeVisible();
  expect(refreshes).toBe(0);
  expect(writes).toBe(0);
});
