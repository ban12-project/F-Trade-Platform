import { expect, test } from "@playwright/test";

const root = "/testing/error-recovery";
const failureTitle = "暂时无法显示此页面";
for (const route of [root, `${root}/workspace`]) {
  for (const width of [320, 1280]) {
    test(`server error can re-fetch and recover at ${route} (${width}px)`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      if (!baseURL) throw new Error("Browser baseURL is required");
      await context.addCookies([{ name: "synthetic-error-recovery", value: "fail", url: baseURL }]);
      await page.goto(route);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: failureTitle, level: 1 })).toBeVisible();
      await expect(page).toHaveTitle("暂时无法显示此页面 · F-Trade");
      await expect(page.locator("title")).toHaveCount(1);
      await expect(main).not.toContainText("SYNTHETIC_PRIVATE_SERVER_DETAIL");
      await expect(main).toContainText("未保存的内容可能已丢失");
      await expect(main.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
        "href",
        "/workspace",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      // Changing the server input alone cannot fix a cached RSC result: retry must re-fetch.
      await context.clearCookies({ name: "synthetic-error-recovery" });
      const retry = main.getByRole("button", { name: "重试加载" });
      await retry.focus();
      await expect(retry).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "合成页面已加载" })).toBeVisible();
      await expect(page.getByRole("heading", { name: failureTitle })).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
    });
  }
  test(`client error details stay out of recovery UI at ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.getByRole("button", { name: "触发合成客户端异常" }).click();
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: failureTitle })).toBeVisible();
    await expect(page).toHaveTitle("暂时无法显示此页面 · F-Trade");
    await expect(page.locator("title")).toHaveCount(1);
    await expect(main).not.toContainText("SYNTHETIC_PRIVATE_CLIENT_DETAIL");
    await main.getByRole("button", { name: "重试加载" }).click();
    await expect(page.getByRole("heading", { name: "合成页面已加载" })).toBeVisible();
  });
}

test("workspace error recovery keeps the shell and protects a surviving draft", async ({
  page,
}) => {
  await page.goto(`${root}/workspace`);
  const navigation = page.getByTestId("workspace-navigation");
  const original = await navigation.elementHandle();
  await page.getByLabel("测试草稿").fill("SYNTHETIC surviving layout draft");
  await page.getByRole("button", { name: "触发合成客户端异常" }).click();
  await expect(page.getByRole("heading", { name: failureTitle })).toBeVisible();
  expect(
    await page.evaluate(
      (element) => element === document.querySelector('[data-testid="workspace-navigation"]'),
      original,
    ),
  ).toBe(true);
  await expect(page.getByLabel("测试草稿")).toHaveValue("SYNTHETIC surviving layout draft");
  await page.getByRole("button", { name: "重试加载" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByRole("heading", { name: failureTitle })).toBeVisible();
  await expect(page.getByLabel("测试草稿")).toHaveValue("SYNTHETIC surviving layout draft");
  await page.getByRole("link", { name: "返回工作台", exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(new RegExp(`${root}/workspace$`));
  await expect(page.getByLabel("测试草稿")).toHaveValue("SYNTHETIC surviving layout draft");
  await page.getByRole("button", { name: "重试加载" }).click();
  await confirmation.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page.getByRole("heading", { name: "合成页面已加载" })).toBeVisible();
});

test("root boundary recovers a failed workspace layout without requiring its providers", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Browser baseURL is required");
  await context.addCookies([{ name: "synthetic-layout-error", value: "fail", url: baseURL }]);
  await page.goto(`${root}/workspace`);
  await expect(page.getByRole("heading", { name: failureTitle })).toBeVisible();
  await expect(page.getByTestId("workspace-navigation")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("SYNTHETIC_PRIVATE_LAYOUT_DETAIL");
  await context.clearCookies({ name: "synthetic-layout-error" });
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.getByRole("heading", { name: "合成页面已加载" })).toBeVisible();
  await expect(page.getByTestId("workspace-navigation")).toBeVisible();
});
