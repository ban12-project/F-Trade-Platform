import { expect, test } from "@playwright/test";

for (const kind of ["quotation", "delivery", "receipt"] as const) {
  test(`${kind} waits for initialization and retains its first edit`, async ({ page }) => {
    const record = kind === "delivery" ? "delivery" : "quotation";
    const state =
      kind === "delivery"
        ? "delivery-pending"
        : kind === "receipt"
          ? "quote-approved"
          : "quote-review";
    const prefix =
      kind === "delivery" ? "delivery-" : kind === "receipt" ? "quote-send-" : "quote-decision-";
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
      await held;
      await route.continue();
    });
    const form = page.locator(`form[id^="${prefix}"]`);
    const text = form.getByRole("textbox", { name: kind === "receipt" ? "发送渠道" : /备注/ });
    const submit = page.locator(`button[type="submit"][form^="${prefix}"]`);
    try {
      await page.goto(`/testing/project-workflow?kind=sales&record=${record}&state=${state}`, {
        waitUntil: "commit",
      });
      await expect(text).toBeVisible();
      await expect(form).toHaveAttribute("aria-busy", "true");
      const controls = form.locator(
        'input:not([type="hidden"]), textarea, button[role="combobox"]',
      );
      for (const control of await controls.all()) await expect(control).toBeDisabled();
      await expect(submit).toBeDisabled();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(text).toBeEnabled();
    await text.fill(`SYNTHETIC first ${kind} edit`);
    if (kind === "receipt") {
      await form.getByLabel("平台消息编号或回执链接").fill("SYNTHETIC-receipt-001");
    } else {
      const decision = form.getByRole("combobox", { name: "决定", exact: true });
      const option = kind === "delivery" ? "拒绝确认" : "退回人工报价";
      await expect(decision).toContainText(
        kind === "delivery" ? "请选择交期决定" : "请选择审核决定",
      );
      await decision.click();
      await page.getByRole("option", { name: option, exact: true }).click();
      await expect(decision).toContainText(option);
    }
    await expect(text).toHaveValue(`SYNTHETIC first ${kind} edit`);
    await expect(form).toHaveAttribute("aria-busy", "false");
    await expect(submit).toBeEnabled();
  });
}
