import { expect, test } from "@playwright/test";

for (const kind of ["quotation", "delivery", "receipt"] as const) {
  test(`${kind} submission locks its snapshot and restores editing after rejection`, async ({
    page,
  }) => {
    const record = kind === "delivery" ? "delivery" : "quotation";
    const state =
      kind === "delivery"
        ? "delivery-pending"
        : kind === "receipt"
          ? "quote-approved"
          : "quote-review";
    const prefix =
      kind === "delivery" ? "delivery-" : kind === "receipt" ? "quote-send-" : "quote-decision-";
    await page.goto(`/testing/project-workflow?kind=sales&record=${record}&state=${state}`);
    const form = page.locator(`form[id^="${prefix}"]`);
    const text = form.getByRole("textbox", { name: kind === "receipt" ? "发送渠道" : /备注/ });
    await text.fill("SYNTHETIC submitted value");
    if (kind === "receipt") {
      await form.getByLabel("平台消息编号或回执链接").fill("SYNTHETIC-receipt-001");
    } else {
      await form
        .getByRole("radiogroup", { name: "决定", exact: true })
        .getByRole("radio", {
          name: kind === "delivery" ? "确认交期" : "批准人工报价",
          exact: true,
        })
        .click();
      if (kind === "delivery") await form.getByLabel("确认交期（天）").fill("30");
      await form.getByRole("combobox", { name: "审核依据", exact: true }).click();
      await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
    }
    let release = () => {};
    let requested = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() === "POST") {
        requested = true;
        await held;
      }
      await route.continue();
    });
    const submit = page.locator(`button[type="submit"][form^="${prefix}"]`);
    try {
      await submit.click();
      await expect.poll(() => requested).toBe(true);
      await expect(text).toBeDisabled();
      const controls = form.locator(
        'input:not([type="hidden"]), textarea, button[role="combobox"], button[role="radio"]',
      );
      for (const control of await controls.all()) await expect(control).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect(form).toHaveAttribute("aria-busy", "true");
    } finally {
      release();
    }
    // No signed session: the real Action rejects without a business write.
    await expect(submit).toBeEnabled();
    await expect(text).toBeEnabled();
    await expect(text).toHaveValue("SYNTHETIC submitted value");
    await expect(form).toHaveAttribute("aria-busy", "false");
    await text.fill("SYNTHETIC corrected value");
    await expect(text).toHaveValue("SYNTHETIC corrected value");
  });
}
