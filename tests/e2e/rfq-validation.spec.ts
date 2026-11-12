import { expect, test } from "@playwright/test";

const path = "/testing/project-workflow?kind=sales&record=rfq-new";

test("invalid RFQ focuses the first custom field, explains errors, and retains the draft", async ({
  page,
}) => {
  await page.goto(path);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page
    .getByRole("textbox", { name: "客户名称", exact: true })
    .fill("SYNTHETIC retained buyer");
  const product = page.getByRole("combobox", { name: "产品类型", exact: true });
  const evidence = page.getByRole("combobox", { name: "客户需求来源", exact: true });
  const save = page.getByRole("button", { name: "保存询盘", exact: true });
  await save.click();
  await expect(product).toBeFocused();
  await expect(product).toHaveAccessibleDescription("请确认客户需要的产品类型。");
  await expect(evidence).toHaveAttribute("aria-invalid", "true");
  await product.press("ArrowDown");
  await page.getByRole("option", { name: "离合器套件", exact: true }).press("Enter");
  await save.click();
  await expect(evidence).toBeFocused();
  await expect(evidence).toHaveAccessibleDescription(
    "请选择与本次操作对应的文件。 请选择来源资料。",
  );
  await expect(product).toHaveAttribute("aria-invalid", "false");
  await expect(product).not.toHaveAttribute("aria-describedby");
  await expect(page.getByRole("textbox", { name: "客户名称", exact: true })).toHaveValue(
    "SYNTHETIC retained buyer",
  );
  expect(posts).toEqual([]);
});

test("RFQ text errors remain associated and recover after editing on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const name = page.getByRole("textbox", { name: "客户名称", exact: true });
  const year = page.getByRole("textbox", { name: "车型年份", exact: true });
  await name.fill("X".repeat(241));
  await year.fill("Y".repeat(241));
  await page.getByRole("button", { name: "保存询盘", exact: true }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription("字段不能超过 240 个字符。");
  await expect(year).toHaveAccessibleDescription("字段不能超过 240 个字符。");
  await name.fill("SYNTHETIC corrected buyer");
  await year.fill("SYNTHETIC requested year");
  await expect(name).not.toHaveAttribute("aria-describedby");
  await expect(year).not.toHaveAttribute("aria-describedby");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
