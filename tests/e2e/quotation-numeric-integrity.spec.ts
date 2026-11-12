import { expect, test } from "@playwright/test";

for (const revision of [false, true]) {
  test(`${revision ? "revised" : "new"} quotation rejects lossy numbers without altering the human draft`, async ({
    page,
  }) => {
    await page.goto(
      `/testing/project-workflow?kind=sales&record=quotation${revision ? "&state=quote-revision" : ""}`,
    );
    const form = page.locator('form[id^="quotation-"]');
    const inputs = [
      { label: "单价", invalid: "9999999999999.9999", valid: "12.5000" },
      { label: "最小起订量（MOQ）", invalid: "9007199254740993", valid: "10" },
      { label: "交期（天）", invalid: "9".repeat(400), valid: "0" },
      { label: "有效期（天）", invalid: "9007199254740992", valid: "30" },
    ];
    await form.getByLabel("付款条件", { exact: true }).fill("SYNTHETIC manual terms");
    await form.getByRole("combobox", { name: "报价依据", exact: true }).click();
    await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
    for (const { label, invalid } of inputs)
      await form.getByLabel(label, { exact: true }).fill(invalid);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    await page
      .getByRole("button", {
        name: revision ? "提交修订并再次送审" : "创建报价并提交审核",
        exact: true,
      })
      .click();
    await expect(
      form.getByText("单价超出可准确保存的范围，请核对金额；系统不会自动四舍五入。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      form.getByText("交期超出可准确保存的整数范围，请核对。", { exact: true }),
    ).toBeVisible();
    await expect(
      form.getByText("数值超出可准确保存的整数范围，请核对。", { exact: true }),
    ).toHaveCount(2);
    for (const { label, invalid, valid } of inputs) {
      const input = form.getByLabel(label, { exact: true });
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveValue(invalid);
      await input.fill(valid);
      await expect(input).toHaveAttribute("aria-invalid", "false");
    }
    await expect(form.getByLabel("付款条件", { exact: true })).toHaveValue(
      "SYNTHETIC manual terms",
    );
    expect(posts).toEqual([]);
  });
}
