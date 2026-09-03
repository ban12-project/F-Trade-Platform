import { expect, test } from "@playwright/test";

test("manual product intake exposes evidence-bound specification and commercial facts", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });

  await page.goto("/testing/product-field-evidence");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "手动录入" }).click();

  const form = page.locator("form#create-product");
  await expect(form.getByText("每个事实必须绑定自己的私有证据", { exact: false })).toBeVisible();
  await expect(form.locator('input[id$="-evidence"]')).toHaveCount(20);

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
    "套件组成证据",
    "毛重证据",
    "净重证据",
    "包装尺寸证据",
    "最小起订量证据",
    "预计交期证据",
    "包装方式证据",
    "支持定制证据",
    "样品可用性证据",
  ] as const) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  }

  await expect(form.getByText("套件与包装规格", { exact: true })).toBeVisible();
  await expect(form.getByText("商业信息", { exact: true })).toBeVisible();
  await expect(form.getByLabel("套件组成证据", { exact: true })).toBeDisabled();
  await expect(form.getByRole("button", { name: "可提供样品" })).toBeVisible();
  await expect(form.getByRole("button", { name: "暂不提供样品" })).toBeVisible();
  await expect(form.locator("#evidence-ref")).toHaveCount(0);
  await expect(form.getByText("系统不会自动复制", { exact: false })).toBeVisible();
  await expect(form.getByText("不得根据经验或图片推断", { exact: false })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
