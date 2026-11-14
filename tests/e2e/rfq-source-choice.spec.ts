import { expect, test } from "@playwright/test";

const path = "/testing/project-workflow?kind=sales&record=rfq-new";

test("source choices use latest received customer context without filling demand", async ({
  page,
}) => {
  await page.goto(path);
  const source = page.getByRole("combobox", { name: "来源客户会话（可选）" });
  await source.click();
  await expect(
    page.getByRole("option", { name: /SYNTHETIC buyer requests 500 clutch kits/ }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: /older customer|seller reply/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /暂无可显示的客户消息.*00000621/ })).toBeVisible();
  await page.getByRole("option", { name: /SYNTHETIC buyer requests 500 clutch kits/ }).click();
  await expect(source).toContainText("SYNTHETIC buyer requests 500 clutch kits");
  await expect(page.getByRole("link", { name: "查看客户会话", exact: true })).toHaveAttribute(
    "href",
    /records\/lead\/00000000-0000-4000-8000-000000000601$/,
  );
  await expect(page.getByRole("textbox", { name: "客户名称", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "数量", exact: true })).toHaveValue("");
  await source.click();
  await page.getByRole("option", { name: /暂无可显示的客户消息.*00000621/ }).click();
  await expect(page.getByRole("link", { name: "查看客户会话", exact: true })).toHaveAttribute(
    "href",
    /00000621$/,
  );
  await source.click();
  await page.getByRole("option", { name: "不关联客户会话", exact: true }).click();
  await expect(page.getByRole("link", { name: "查看客户会话", exact: true })).toHaveCount(0);
});

test("long customer excerpts stay within a narrow selector and support keyboard selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const source = page.getByRole("combobox", { name: "来源客户会话（可选）" });
  await expect(source).toBeEnabled();
  await source.focus();
  await expect(source).toBeFocused();
  await source.press("ArrowDown");
  const option = page.getByRole("option", { name: /SYNTHETIC-SYNTHETIC.*00000611/ });
  await expect(option).toBeVisible();
  expect(await option.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await option.press("Enter");
  await expect(source).toContainText("00000611");
  expect(await source.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("conversation-created RFQ shows its locked source context", async ({ page }) => {
  await page.goto(`${path}&state=rfq-source-locked`);
  const source = page.getByRole("combobox", { name: "来源客户会话（可选）" });
  await expect(source).toBeDisabled();
  await expect(source).toContainText("SYNTHETIC buyer requests 500 clutch kits");
  await expect(page.getByRole("link", { name: "查看客户会话", exact: true })).toHaveAttribute(
    "href",
    /00000601$/,
  );
  await expect(page.getByRole("textbox", { name: "数量", exact: true })).toHaveValue("");
});
