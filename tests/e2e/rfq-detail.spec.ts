import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const route = "/testing/project-workflow?kind=sales&record=rfq";

for (const state of ["rfq-ready", "rfq-collecting"]) {
  test(`saved customer and vehicle context remains visible for ${state}`, async ({ page }) => {
    await page.goto(`${route}&state=${state}`);
    const customer = page.getByRole("region", { name: "已保存的客户信息" });
    await expect(customer.getByText("Synthetic Buyer", { exact: true })).toBeVisible();
    await expect(customer.getByText("MOCK parts", { exact: true })).toBeVisible();
    await expect(customer.getByText("Synthetic Country", { exact: true })).toBeVisible();
    const demand = page.getByRole("region", { name: "已保存的采购需求" });
    for (const value of [
      "离合器套件",
      "SYN-OE-001",
      "SYNTHETIC brand",
      "SYNTHETIC model",
      "500",
      "Synthetic Port",
    ]) {
      await expect(demand.getByText(value, { exact: true })).toBeVisible();
    }
    await expect(demand).toContainText("不能据此认定适配");
    await expect(page.getByText("SYNTHETIC individual packaging", { exact: true })).toBeVisible();
    await expect(page.getByText("SYNTHETIC requested month", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "需求完整度" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    await expect(page.getByRole("link", { name: "打开人工报价", exact: true })).toHaveAttribute(
      "href",
      /records\/quotation\/00000000-0000-4000-8000-000000000603$/,
    );
    if (state === "rfq-ready") {
      await expect(page.getByRole("textbox", { name: "公司", exact: true })).toHaveCount(0);
      await expect(page.getByText("需求已确认完整", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("textbox", { name: "公司", exact: true })).toHaveValue(
        "MOCK parts",
      );
      await page
        .getByRole("textbox", { name: "公司", exact: true })
        .fill("SYNTHETIC unsaved company");
      await expect(customer).toContainText("MOCK parts");
      await expect(customer).not.toContainText("SYNTHETIC unsaved company");
    }
  });
}

test("missing RFQ facts remain explicit without assuming product identity or readiness", async ({
  page,
}) => {
  await page.goto(`${route}&state=rfq-missing`);
  await expect(
    page.getByRole("region", { name: "已保存的客户信息" }).getByText("未提供", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "已保存的采购需求" }).getByText("未提供", { exact: true }),
  ).toHaveCount(5);
  await expect(page.getByRole("progressbar", { name: "需求完整度" })).toHaveAttribute(
    "aria-valuenow",
    "10",
  );
  await expect(page.getByRole("button", { name: "确认需求完整", exact: true })).toBeDisabled();
});

test("long saved RFQ context fits a narrow viewport and has accessible sections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${route}&state=rfq-long`);
  const customer = page.getByRole("region", { name: "已保存的客户信息" });
  await expect(customer).toContainText("SYNTHETIC-LONG-COMPANY-".repeat(10));
  await expect(page.getByRole("region", { name: "已保存的采购需求" })).toContainText(
    "SYNTHETIC-LONG-MODEL-".repeat(10),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const audit = await new AxeBuilder({ page })
    .include('[aria-label="已保存的客户信息"]')
    .include('[aria-label="已保存的采购需求"]')
    .analyze();
  expect(audit.violations).toEqual([]);
});
