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
  await expect(form.getByLabel("产品名称证据", { exact: true })).toBeRequired();
  await expect(form.getByLabel("产品类型证据", { exact: true })).toBeRequired();
  await expect(form.getByLabel("内部编号证据", { exact: true })).toBeRequired();
  await expect(form.locator("#evidence-ref")).toHaveCount(0);

  await form.getByLabel("产品名称", { exact: true }).fill("Synthetic clutch disc");
  await form.getByLabel("产品名称证据", { exact: true }).fill("evidence-name-701");
  await form.getByLabel("产品类型证据", { exact: true }).fill("evidence-type-701");
  await form.getByLabel("内部编号", { exact: true }).fill("SYN-701");
  await form.getByLabel("内部编号证据", { exact: true }).fill("evidence-sku-701");
  await form.getByLabel("来源引用", { exact: true }).fill("source-catalog-701");
  await form.getByLabel("盘径（mm）", { exact: true }).fill("240");

  await page.getByRole("button", { name: "创建待审核草稿" }).click();
  await expect(form.getByText("盘径已填写，必须单独绑定证据引用。")).toBeVisible();

  await form.getByLabel("盘径证据", { exact: true }).fill("evidence-diameter-701");
  await form.getByLabel("盘径（mm）", { exact: true }).fill("");
  await page.getByRole("button", { name: "创建待审核草稿" }).click();
  await expect(form.getByText("盘径未填写，不能单独保留证据引用。")).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});
