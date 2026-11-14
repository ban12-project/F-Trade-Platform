import { expect, test } from "@playwright/test";

for (const width of [320, 1280]) {
  test(`unknown URL offers a localized 404 and keyboard escape (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const response = await page.goto("/synthetic-unknown-page");
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle("找不到页面 · F-Trade");
    await expect(page.locator("title")).toHaveCount(1);
    const main = page.getByRole("main");
    await expect(main).toHaveCount(1);
    await expect(main.locator("h1")).toHaveText("找不到页面");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
    await page.keyboard.press("Tab");
    const back = main.getByRole("link", { name: "返回工作台" });
    await expect(back).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
  });

  test(`inaccessible project has a real main target and generic explanation (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/testing/error-recovery/workspace/missing-project");
    const main = page.getByRole("main");
    await expect(main).toHaveCount(1);
    await expect(main.locator("h1")).toHaveText("无法打开此项目");
    await expect(page).toHaveTitle("无法打开此项目 · F-Trade");
    await expect(page.locator("title")).toHaveCount(1);
    await expect(main).toContainText("该项目不可用，或你没有查看权限。");
    const skip = page.getByRole("link", { name: "跳到主要内容" });
    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
    await expect(main.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByLabel("测试草稿").fill("SYNTHETIC surviving draft");
    await main.getByRole("link", { name: "返回工作台" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "继续编辑" }).click();
    await expect(page.getByLabel("测试草稿")).toHaveValue("SYNTHETIC surviving draft");
  });

  test(`root layout exception keeps a styled recovery document and can retry (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/testing/error-recovery");
    await page.waitForFunction("typeof window.__fTradeFailRoot === 'function'");
    await page.evaluate("window.__fTradeFailRoot()");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "工作台暂时无法打开", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("工作台暂时无法打开 · F-Trade");
    await expect(page.locator("title")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(main.locator("h1")).toBeFocused();
    await expect(main).not.toContainText("SYNTHETIC_PRIVATE_ROOT_DETAIL");
    await expect(main).toContainText("未保存的内容可能已丢失");
    expect(
      await page.evaluate(() => ({
        width: document.documentElement.scrollWidth <= innerWidth,
        background: getComputedStyle(document.body).backgroundColor,
        font: getComputedStyle(document.body).fontFamily,
      })),
    ).toMatchObject({ width: true, font: "system-ui, sans-serif" });
    expect(
      await main
        .getByRole("button", { name: "重试加载" })
        .evaluate((button) => parseFloat(getComputedStyle(button).borderRadius)),
    ).toBeGreaterThan(0);
    await main.getByRole("button", { name: "重试加载" }).click();
    await expect(page.getByRole("heading", { name: "合成页面已加载" })).toBeVisible();
    await expect(page).toHaveTitle("F-Trade 工作台");
    await expect(page.locator("title")).toHaveCount(1);
    await page.waitForFunction("typeof window.__fTradeFailRoot === 'function'");
    await page.evaluate("window.__fTradeFailRoot()");
    const back = page.getByRole("link", { name: "返回工作台" });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
  });
}
