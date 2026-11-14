import { expect, test } from "@playwright/test";

for (const kind of ["quotation", "delivery"] as const) {
  test(`${kind} rejection focuses missing evidence then explains missing notes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/testing/project-workflow?kind=sales&record=${kind}&state=${kind === "quotation" ? "quote-review" : "delivery-pending"}`,
    );
    const form = page.locator(
      kind === "quotation" ? 'form[id^="quote-decision-"]' : 'form[id^="delivery-"]',
    );
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) writes++;
    });
    await form.getByRole("combobox", { name: "决定", exact: true }).click();
    await page
      .getByRole("option", {
        name: kind === "quotation" ? "退回人工报价" : "拒绝确认",
        exact: true,
      })
      .click();
    const submit = page.getByRole("button", {
      name: kind === "quotation" ? "退回人工报价" : "拒绝交期确认",
      exact: true,
    });
    const evidence = form.getByRole("combobox", { name: "审核依据", exact: true });
    const notes = form.getByRole("textbox", { name: /备注/ });
    await submit.click();
    await expect(evidence).toBeFocused();
    await expect(evidence).toHaveAccessibleDescription(/请选择来源资料。/);
    await evidence.press("ArrowDown");
    await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
    await submit.click();
    await expect(notes).toBeFocused();
    await expect(notes).toHaveAccessibleDescription(
      kind === "quotation" ? "退回报价时必须填写原因。" : "拒绝交期确认时必须填写原因。",
    );
    await notes.fill("SYNTHETIC missing factory confirmation");
    await expect(notes).toHaveAttribute("aria-invalid", "false");
    await expect(notes).not.toHaveAttribute("aria-describedby");
    await expect(evidence).not.toHaveAccessibleDescription(/请选择来源资料。/);
    expect(writes).toBe(0);
  });
}

test("delivery confirmation focuses missing days before evidence", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&record=delivery&state=delivery-pending");
  const form = page.locator('form[id^="delivery-"]');
  await form.getByRole("combobox", { name: "决定", exact: true }).click();
  await page.getByRole("option", { name: "确认交期", exact: true }).click();
  await page.getByRole("button", { name: "确认人工交期", exact: true }).click();
  const days = form.getByLabel("确认交期（天）", { exact: true });
  await expect(days).toBeFocused();
  await expect(days).toHaveAccessibleDescription(/批准交期时必须填写非负整数天数。/);
  await days.fill("30");
  await page.getByRole("button", { name: "确认人工交期", exact: true }).click();
  await expect(form.getByRole("combobox", { name: "审核依据", exact: true })).toBeFocused();
  await expect(days).toHaveAccessibleDescription(
    /填写工厂核实的交期天数；与确认结果的 7\s*天有效期不同/,
  );
});
