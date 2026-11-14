import { expect, test } from "@playwright/test";

for (const revision of [false, true]) {
  test(`${revision ? "revised" : "new"} quotation describes invalid commercial terms and clears errors on correction`, async ({
    page,
  }) => {
    await page.goto(
      `/testing/project-workflow?kind=sales&record=quotation${revision ? "&state=quote-revision" : ""}`,
    );
    const form = page.locator('form[id^="quotation-"]');
    const fields = [
      { label: "单价", invalid: "-1", valid: "12.50", error: "单价必须是正数，最多四位小数。" },
      { label: "币种", invalid: "usd", valid: "USD", error: "币种必须是三位大写 ISO 代码。" },
      { label: "最小起订量（MOQ）", invalid: "0", valid: "10", error: "必须填写正整数。" },
      { label: "交期（天）", invalid: "-1", valid: "3", error: "交期天数必须是非负整数。" },
      {
        label: "付款条件",
        invalid: "",
        valid: "SYNTHETIC manual terms",
        error: "请填写付款条件。",
      },
    ];
    for (const field of fields)
      await form.getByLabel(field.label, { exact: true }).fill(field.invalid);
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") writes++;
    });
    await page
      .getByRole("button", {
        name: revision ? "提交修订并再次送审" : "创建报价并提交审核",
        exact: true,
      })
      .click();
    await expect(form.getByLabel("单价", { exact: true })).toBeFocused();
    for (const field of fields) {
      const input = form.getByLabel(field.label, { exact: true });
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveAccessibleDescription(field.error);
      await expect(input).toHaveValue(field.invalid);
      await input.fill(field.valid);
      await expect(input).toHaveAttribute("aria-invalid", "false");
      await expect(input).not.toHaveAccessibleDescription(field.error);
    }
    const evidence = form.getByRole("combobox", { name: "报价依据", exact: true });
    await expect(evidence).toHaveAccessibleDescription(/请选择来源资料/);
    await evidence.click();
    await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
    await expect(evidence).toHaveAttribute("aria-invalid", "false");
    await expect(evidence).not.toHaveAccessibleDescription(/请选择来源资料/);
    expect(writes).toBe(0);
  });
}
