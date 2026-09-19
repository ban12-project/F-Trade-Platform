import { expect, test } from "@playwright/test";

const root = "/testing/workspace-navigation";
const projectId = "00000000-0000-4000-8000-000000000263";

test("shared navigation stays mounted and interactive while a child route streams", async ({
  page,
}) => {
  await page.goto(root);
  const dock = page.getByTestId("workspace-navigation");
  await expect(dock).toBeVisible();
  const original = await dock.elementHandle();
  const click = page.getByRole("link", { name: "切换测试页面" }).click({ noWaitAfter: true });
  await expect(page.getByRole("status", { name: "正在加载项目工作区" })).toBeVisible();
  await expect(dock).toHaveCount(1);
  expect(
    await page.evaluate(
      (element) => element === document.querySelector('[data-testid="workspace-navigation"]'),
      original,
    ),
  ).toBe(true);
  await expect(dock.getByRole("link", { name: "今日任务" })).toBeEnabled();
  await click;
  await expect(page.getByRole("heading", { name: "Synthetic persistent workspace" })).toBeVisible();
  expect(
    await page.evaluate(
      (element) => element === document.querySelector('[data-testid="workspace-navigation"]'),
      original,
    ),
  ).toBe(true);
  await expect(page.getByRole("link", { name: /Synthetic persistent workspace/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goBack();
  await expect(page.getByRole("heading", { name: "导航测试起点" })).toBeVisible();
  expect(
    await page.evaluate(
      (element) => element === document.querySelector('[data-testid="workspace-navigation"]'),
      original,
    ),
  ).toBe(true);
});

test("page and navigation share one unsaved-changes guard across navigation", async ({ page }) => {
  await page.goto(root);
  await page.getByLabel("测试草稿").fill("Do not lose this draft");
  await page.getByRole("link", { name: /Synthetic persistent workspace/ }).click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(confirmation).toHaveCount(1);
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("测试草稿")).toHaveValue("Do not lose this draft");
  await expect(page).toHaveURL(new RegExp(`${root}$`));
  await page.getByRole("link", { name: /Synthetic persistent workspace/ }).click();
  await confirmation.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page).toHaveURL(new RegExp(`${projectId}$`));
  await expect(page.getByRole("heading", { name: "Synthetic persistent workspace" })).toBeVisible();
  await expect(confirmation).toHaveCount(0);
});

test("discarding a persistent new-project form resets its dirty state and values", async ({
  page,
}) => {
  await page.goto(root);
  await page.getByRole("button", { name: "开始新工作", exact: true }).click();
  await page.getByLabel("归属项目").selectOption("new");
  await page.getByLabel("项目名称").fill("Unsaved synthetic project");
  await page
    .getByRole("dialog", { name: "开始新工作" })
    .getByRole("button", { name: "Close" })
    .click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue("Unsaved synthetic project");
  await page
    .getByRole("dialog", { name: "开始新工作" })
    .getByRole("button", { name: "Close" })
    .click();
  await confirmation.getByRole("button", { name: "放弃修改并离开" }).click();
  await page.getByRole("button", { name: "开始新工作", exact: true }).click();
  await page.getByLabel("归属项目").selectOption("new");
  await expect(page.getByLabel("项目名称")).toHaveValue("");
});

test("discarding a new-work dialog does not unregister the underlying page draft", async ({
  page,
}) => {
  await page.goto(root);
  await page.getByLabel("测试草稿").fill("Keep guarding the underlying draft");
  await page.getByRole("button", { name: "开始新工作", exact: true }).click();
  await page.getByLabel("归属项目").selectOption("new");
  await page.getByLabel("项目名称").fill("Discard only this dialog draft");
  await page
    .getByRole("dialog", { name: "开始新工作" })
    .getByRole("button", { name: "Close" })
    .click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await confirmation.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page.getByLabel("测试草稿")).toHaveValue("Keep guarding the underlying draft");
  await expect(page).toHaveURL(new RegExp(`${root}$`));
  await page.getByRole("link", { name: /Synthetic persistent workspace/ }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(new RegExp(`${root}$`));
});

test("starting work from a dirty page asks once and cancelling keeps the original draft", async ({
  page,
}) => {
  await page.goto(root);
  await page.getByLabel("测试草稿").fill("Keep this until I choose to leave");
  const start = page.getByRole("button", { name: "开始新工作", exact: true });
  await start.click();
  await page.getByRole("button", { name: "在此项目开始录入产品" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("测试草稿")).toHaveValue("Keep this until I choose to leave");
  await start.click();
  await page.getByRole("button", { name: "在此项目开始录入产品" }).click();
  await confirmation.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page).toHaveURL(new RegExp(`${projectId}[?]panel=product$`));
  await expect(confirmation).toHaveCount(0);
});
