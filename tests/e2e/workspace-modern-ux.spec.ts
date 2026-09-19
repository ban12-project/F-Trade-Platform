import { expect, test } from "@playwright/test";

const navigationFixture = "/testing/workspace-navigation";

test("skip link transfers keyboard focus into the workspace main landmark", async ({
  page,
  browserName,
}) => {
  await page.goto("/testing/workspace-dashboard");
  // This fixture streams its main landmark; wait for the target before activating the link.
  await expect(page.getByRole("heading", { name: "今日任务" })).toBeVisible();
  // macOS Safari uses Option-Tab for links unless full keyboard navigation is enabled.
  await page.keyboard.press(
    browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
  );
  const skip = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
});

test("streaming keeps a main target and a text-bearing status outside its busy subtree", async ({
  page,
}) => {
  await page.goto(navigationFixture);
  // Confirm hydration through an actual interaction before testing a client-side transition.
  // Otherwise slower engines can follow the SSR anchor as a full document navigation.
  await page.getByRole("button", { name: "开始新工作", exact: true }).click();
  const projects = page.getByRole("dialog", { name: "开始新工作", exact: true });
  await expect(projects).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(projects).toBeHidden();
  const click = page.getByRole("link", { name: "切换测试页面" }).click({ noWaitAfter: true });
  const status = page.getByRole("status", { name: "正在加载项目工作区" });
  await expect(status).toBeVisible();
  await expect(status).toHaveText("正在加载项目工作区");
  const main = page.getByRole("main");
  await expect(main).toHaveAttribute("id", "main-content");
  await expect(main).toHaveAttribute("aria-busy", "true");
  await expect(main.getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("workspace-navigation")).toHaveCount(1);
  await click;
  await expect(page.getByRole("heading", { name: "Synthetic persistent workspace" })).toBeVisible();
});

test("new work exposes its controlled dialog and restores keyboard focus on Escape", async ({
  page,
}) => {
  await page.goto(navigationFixture);
  const trigger = page.getByRole("button", {
    name: "开始新工作",
    exact: true,
    includeHidden: true,
  });
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "开始新工作", exact: true });
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("aria-controls", (await dialog.getAttribute("id")) ?? "");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("new-project validation connects the field, error and group name without a write", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/testing/workspace-navigation", async (route) => {
    if (route.request().method() === "POST") {
      writes += 1;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto(navigationFixture);
  await page.getByRole("button", { name: "开始新工作", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "开始新工作", exact: true });
  await dialog.getByLabel("归属项目").selectOption("new");
  const title = dialog.getByLabel("项目名称", { exact: true });
  await expect(title).toHaveAttribute("required", "");
  await expect(dialog.locator('[data-slot="toggle-group"]')).toHaveAccessibleName("这次要做什么");
  await dialog.getByRole("button", { name: "创建项目并开始" }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription(/.+/);
  await expect(title).toBeFocused();
  const descriptionId = await title.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  await expect(dialog.locator(`[id="${descriptionId}"]`)).toContainText(/.+/);
  expect(writes).toBe(0);
});

test("touch controls have two-dimensional targets and the drawer has an explicit close", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(navigationFixture);
    const trigger = page.getByRole("button", { name: "打开导航" });
    const target = await trigger.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    const drawer = page.getByRole("dialog", { name: "工作区导航", exact: true });
    await expect(drawer).toBeVisible();
    for (const link of await drawer
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("link")
      .all()) {
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const close = drawer.getByRole("button", { name: "关闭", exact: true });
    await expect(close).toBeInViewport();
    await close.tap();
    await expect(drawer).toBeHidden();
    await page.goto("/testing/project-workspace");
    const back = await page.getByRole("link", { name: "返回工作台" }).boundingBox();
    expect(back?.width).toBeGreaterThanOrEqual(44);
    expect(back?.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});

test("small mobile dialogs stay within the viewport and keep submission reachable", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 400 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(navigationFixture);
    await page.getByRole("button", { name: "打开导航" }).tap();
    await page.getByRole("button", { name: "开始新工作", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "开始新工作", exact: true });
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return Boolean(
          box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 400,
        );
      })
      .toBe(true);
    await dialog.getByLabel("归属项目").selectOption("new");
    const submit = dialog.getByRole("button", { name: "创建项目并开始" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    const close = dialog.getByRole("button", { name: "Close" });
    await close.scrollIntoViewIfNeeded();
    await close.tap();
    await expect(dialog).toBeHidden();
  } finally {
    await context.close();
  }
});

test("details use document scrolling at mobile and desktop sizes", async ({ page }) => {
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/testing/project-workflow?panel=product");
    const details = page.getByRole("region", { name: /详情与审批/ });
    await expect(details).toBeVisible();
    await expect(details.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
  }
});

test("reduced motion removes long transitions without breaking dialog centering", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(navigationFixture);
  await page.getByRole("button", { name: "开始新工作", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "开始新工作", exact: true });
  await expect(dialog).toBeVisible();
  const timings = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animation: style.animationDuration.split(",").map(Number.parseFloat),
      transition: style.transitionDuration.split(",").map(Number.parseFloat),
    };
  });
  expect(timings.animation.every((seconds) => seconds <= 0.001)).toBe(true);
  expect(timings.transition.every((seconds) => seconds <= 0.001)).toBe(true);
  const box = await dialog.boundingBox();
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  }));
  expect(box).not.toBeNull();
  expect(size).not.toBeNull();
  if (box && size) {
    expect(Math.abs(box.x + box.width / 2 - size.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - size.height / 2)).toBeLessThanOrEqual(2);
  }
});

test("forced-colors keyboard focus uses an outline rather than only a shadow", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(navigationFixture);
  await page.keyboard.press("Tab");
  const button = page.getByRole("button", { name: "开始新工作", exact: true });
  await button.focus();
  await expect(button).toHaveCSS("outline-style", "solid");
  await expect(button).toHaveCSS("outline-width", "2px");
});

test("workspace section navigation remains available at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/testing/workspace-dashboard");
  const navigation = page.getByRole("navigation", { name: "任务状态" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("link", { name: /等待他人/ }).click();
  await expect(page).toHaveURL(/view=waiting/);
  await expect(page.getByRole("region", { name: "任务清单" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
});
