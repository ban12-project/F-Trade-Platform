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
