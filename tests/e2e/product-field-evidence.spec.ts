import { expect, test } from "@playwright/test";

test("manual product intake exposes one evidence input per fact", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });

  await page.goto("/testing/product-field-evidence");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "手动录入" }).click();

  await expect(page.getByText("每个事实必须绑定自己的私有证据", { exact: false })).toBeVisible();
  await expect(page.locator('input[id$="-evidence"]')).toHaveCount(11);
  await expect(page.getByLabel("产品名称证据")).toBeRequired();
  await expect(page.getByLabel("产品类型证据")).toBeRequired();
  await expect(page.getByLabel("内部编号证据")).toBeRequired();
  await expect(page.locator("#evidence-ref")).toHaveCount(0);

  await page.getByLabel("产品名称").fill("Synthetic clutch disc");
  await page.getByLabel("产品名称证据").fill("evidence-name-701");
  await page.getByLabel("产品类型证据").fill("evidence-type-701");
  await page.getByLabel("内部编号").fill("SYN-701");
  await page.getByLabel("内部编号证据").fill("evidence-sku-701");
  await page.getByLabel("来源引用").fill("source-catalog-701");
  await page.getByLabel("盘径（mm）").fill("240");

  await page.getByRole("button", { name: "创建待审核草稿" }).click();
  await expect(page.getByText("盘径已填写，必须单独绑定证据引用。")).toBeVisible();

  await page.getByLabel("盘径证据").fill("evidence-diameter-701");
  await page.getByLabel("盘径（mm）").fill("");
  await page.getByRole("button", { name: "创建待审核草稿" }).click();
  await expect(page.getByText("盘径未填写，不能单独保留证据引用。")).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});
