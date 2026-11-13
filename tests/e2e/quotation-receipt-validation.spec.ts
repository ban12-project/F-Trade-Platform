import { expect, test } from "@playwright/test";

for (const oversized of [false, true]) {
  test(`receipt ${oversized ? "oversized" : "blank"} values have actionable descriptions and recover without losing input`, async ({
    page,
  }) => {
    await page.goto("/testing/project-workflow?kind=sales&record=quotation&state=quote-approved");
    const form = page.locator('form[id^="quote-send-"]');
    const channel = form.getByLabel("发送渠道", { exact: true });
    const receipt = form.getByLabel("平台消息编号或回执链接", { exact: true });
    const value = oversized ? "X".repeat(241) : "";
    await channel.fill(value);
    await receipt.fill(value);
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") writes++;
    });
    const submit = page.getByRole("button", { name: "核验凭证并登记已发送", exact: true });
    await submit.click();
    await expect(channel).toBeFocused();
    await expect(channel).toHaveAttribute("aria-invalid", "true");
    await expect(channel).toHaveAccessibleDescription(
      oversized ? "发送渠道不能超过 240 个字符。" : "请填写发送渠道。",
    );
    await expect(receipt).toHaveAccessibleDescription(
      oversized
        ? "发送凭证不能超过 240 个字符，请核对消息编号或回执链接。"
        : "请填写外部发送凭证。",
    );
    await expect(channel).toHaveValue(value);
    await expect(receipt).toHaveValue(value);
    await channel.fill("SYNTHETIC email");
    await expect(channel).toHaveAttribute("aria-invalid", "false");
    await expect(channel).toHaveAccessibleDescription("");
    await submit.click();
    await expect(receipt).toBeFocused();
    await expect(channel).toHaveValue("SYNTHETIC email");
    // The exact existing boundary is valid; no browser truncation masks oversize errors.
    await receipt.fill("R".repeat(240));
    await expect(receipt).toHaveAttribute("aria-invalid", "false");
    await expect(receipt).toHaveAccessibleDescription("");
    await expect(receipt).toHaveValue("R".repeat(240));
    expect(writes).toBe(0);
  });
}
