import { expect, test } from "@playwright/test";

for (const kind of ["delivery", "opportunity"] as const) {
  test(`${kind} keeps its evidence snapshot locked and retains it after denial`, async ({
    page,
  }) => {
    await page.goto("/testing/project-workflow?kind=sales&record=lead&state=lead-actions");
    const label = kind === "delivery" ? "客户交期要求依据" : "客户采购意向依据";
    const otherLabel = kind === "delivery" ? "客户采购意向依据" : "客户交期要求依据";
    const choice = page.getByRole("combobox", { name: label, exact: true });
    const form = page.locator("form").filter({ has: choice });
    await choice.click();
    await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() === "POST") {
        requests++;
        await held;
      }
      await route.continue();
    });
    const submit = page.getByRole("button", {
      name: kind === "delivery" ? "申请工厂确认交期" : "确认有效商机",
      exact: true,
    });
    try {
      await submit.click();
      await expect.poll(() => requests).toBe(1);
      await expect(form).toHaveAttribute("aria-busy", "true");
      await expect(choice).toBeDisabled();
      await expect(form.getByRole("button", { name: "上传资料", exact: true })).toBeDisabled();
      await expect(form.getByRole("button", { name: "刷新资料列表", exact: true })).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect(page.getByRole("combobox", { name: otherLabel, exact: true })).toBeEnabled();
    } finally {
      release();
    }
    // The real Action rejects the synthetic browser's unsigned session before business writes.
    await expect(submit).toBeEnabled();
    await expect(choice).toBeEnabled();
    await expect(choice).toContainText("合成审核记录.pdf");
    await expect(form).toHaveAttribute("aria-busy", "false");
    expect(requests).toBe(1);
    await choice.click();
    await expect(page.getByRole("option", { name: "合成审核记录.pdf", exact: true })).toBeVisible();
  });
}
