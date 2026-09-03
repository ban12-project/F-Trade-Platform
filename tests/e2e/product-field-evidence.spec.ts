import { expect, test } from "@playwright/test";

test("manual product intake exposes one evidence input per fact", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });

  await page.goto("/testing/product-field-evidence");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "手动录入" }).click();

  const form = page.locator("form#create-product");
  await expect(form.getByText("每个事实必须绑定自己的私有证据", { exact: false })).toBeVisible();
  await expect(form.locator('input[id$="-evidence"]')).toHaveCount(11);

  for (const label of ["产品名称证据", "产品类型证据", "内部编号证据"] as const) {
    await expect(form.getByLabel(label, { exact: true })).toHaveAttribute("required", "");
  }
  for (const label of [
    "OE / OEM 编号证据",
    "适配说明证据",
    "车辆品牌证据",
    "车型证据",
    "盘径证据",
    "花键数证据",
    "花键尺寸证据",
    "摩擦材料证据",
  ] as const) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  }

  await expect(form.locator("#evidence-ref")).toHaveCount(0);
  await expect(form.getByText("系统不会自动复制", { exact: false })).toBeVisible();
  await expect(form.getByText("事实和对应证据都留空", { exact: false })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
