import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const path = "/testing/project-workflow?record=product&state=product-review";

test("field focus pairs only exact evidence and preserves missing and unavailable states", async ({
  page,
}) => {
  await page.goto(path);
  const focus = page.getByRole("region", { name: "当前字段核对" });
  await expect(
    focus.getByText("MOCK source text: Verified clutch kit", { exact: true }),
  ).toBeVisible();
  await expect(focus.getByText("产品编号", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上一字段" })).toBeDisabled();
  await page.getByRole("button", { name: "下一字段" }).press("Enter");
  await expect(focus.getByText("clutch_kit", { exact: true })).toBeVisible();
  await expect(focus.getByText(/暂时无法打开原文件/)).toBeVisible();
  await expect(focus.getByRole("link")).toHaveCount(0);
  await page.getByRole("combobox", { name: "核对字段" }).click();
  await page.getByRole("option", { name: "样品可用性", exact: true }).click();
  await expect(focus.getByText("否", { exact: true })).toBeVisible();
  await expect(focus.getByText(/此字段尚未关联证据/)).toBeVisible();
  await expect(page.getByRole("button", { name: "下一字段" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "请先选择决定" })).toBeDisabled();
});

test("field review fits mobile and supports keyboard selection without changing review gates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const select = page.getByRole("combobox", { name: "核对字段" });
  await select.focus();
  await select.press("ArrowDown");
  await page.getByRole("option", { name: "产品编号", exact: true }).press("Enter");
  await expect(
    page.getByRole("region", { name: "当前字段核对" }).getByText(/未保留可直接展示的原文片段/),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const accessibility = await new AxeBuilder({ page })
    .include('section[aria-label="当前字段核对"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

for (const state of ["product-review", "product-revision"]) {
  test(`read-only ${state} permits evidence navigation without mutation controls`, async ({
    page,
  }) => {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") writes.push(request.url());
    });
    await page.goto(`/testing/project-workflow?record=product&state=${state}&readonly=1`);
    await expect(
      page.getByText("当前为只读视图。写入和审核由有权限的项目编辑者处理。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "下一字段" }).press("Enter");
    await expect(
      page.getByRole("region", { name: "当前字段核对" }).getByText("clutch_kit", { exact: true }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "核对字段" }).click();
    await page.getByRole("option", { name: "产品名称", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "当前字段核对" })
        .getByRole("link", { name: "打开来源原件（新窗口）" }),
    ).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

test("read-only content still disables mutation controls outside product browsing", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?record=content&state=content-revision&readonly=1");
  await expect(page.getByRole("button", { name: "提交修订并送审" })).toBeDisabled();
  const inputs = page.locator('input:not([type="hidden"]), textarea');
  expect(await inputs.count()).toBeGreaterThan(0);
  for (const input of await inputs.all()) await expect(input).toBeDisabled();
});
