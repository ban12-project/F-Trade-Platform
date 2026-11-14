import { expect, test } from "@playwright/test";

for (const kind of ["delivery", "opportunity"] as const) {
  test(`${kind} describes its missing evidence and supports keyboard recovery without writes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/testing/project-workflow?kind=sales&record=lead&state=lead-actions");
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") writes++;
    });
    const choice = page.getByRole("combobox", {
      name: kind === "delivery" ? "客户交期要求依据" : "客户采购意向依据",
      exact: true,
    });
    const other = page.getByRole("combobox", {
      name: kind === "delivery" ? "客户采购意向依据" : "客户交期要求依据",
      exact: true,
    });
    const form = page.locator("form").filter({ has: choice });
    await page
      .getByRole("button", {
        name: kind === "delivery" ? "申请工厂确认交期" : "确认有效商机",
        exact: true,
      })
      .click();
    await expect(choice).toBeFocused();
    await expect(choice).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByText("请选择来源资料。", { exact: true })).toBeVisible();
    await expect(choice).toHaveAccessibleDescription(
      "请选择与本次操作对应的文件。 请选择来源资料。",
    );
    await expect(other).toHaveAttribute("aria-invalid", "false");
    await expect(other).not.toHaveAccessibleDescription(/请选择来源资料/);
    await choice.press("ArrowDown");
    await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).press("Enter");
    await expect(choice).toContainText("合成审核记录.pdf");
    await expect(choice).toHaveAttribute("aria-invalid", "false");
    await expect(form.getByText("请选择来源资料。", { exact: true })).toHaveCount(0);
    await expect(choice).toHaveAccessibleDescription(
      "已选择：合成审核记录.pdf。请核对是否与本次操作对应。",
    );
    expect(writes).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
}
