import { expect, test } from "@playwright/test";

test("countdown, expiry warning, explicit extension and duplicate-click guard", async ({
  page,
}) => {
  await page.goto("/testing/interactive-session");
  const extend = page.getByRole("button", { name: "延长接管 30 分钟" });
  await expect(page.getByRole("timer")).toContainText(/(30:00|29:5\d)/);
  await expect(extend).toBeDisabled();
  await page.getByRole("button", { name: "模拟即将到期" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("接管即将到期");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("延长不会续期发布核对结果");
  // Two events in the same turn exercise the ref guard before React commits disabled.
  await extend.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText("延长请求次数：1", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText(/34:5\d/);
  await expect(extend).toBeDisabled();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "模拟两秒后到期" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("接管已到期", {
    timeout: 5000,
  });
  await expect(extend).toBeDisabled();
  await expect(page.getByRole("timer")).toContainText("0:00");
});

test("failed extension keeps time and offers an honest retry message", async ({ page }) => {
  await page.goto("/testing/interactive-session");
  await page.getByRole("button", { name: "模拟服务端拒绝" }).click();
  await page.getByRole("button", { name: "延长接管 30 分钟" }).click();
  await expect(page.getByRole("status")).toContainText("未确认延长成功");
  await expect(page.getByRole("timer")).toContainText(/4:5\d/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("接管即将到期");
});
