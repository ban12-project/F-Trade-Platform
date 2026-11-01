import { expect, test } from "@playwright/test";

const root = "/testing/workspace-navigation";

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
