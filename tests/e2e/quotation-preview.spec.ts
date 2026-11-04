import { expect, test } from "@playwright/test";

const approvedPage = "/testing/project-workflow?kind=sales&record=quotation&state=quote-approved";

test("approved quotation copies the visible version without sending or recording delivery", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.goto(approvedPage);
  const text = page.getByRole("textbox", { name: "客户报价文案（英文，只读）" });
  await expect(text).toHaveAttribute("readonly", "");
  await expect(text).toHaveValue(/Approved quotation record version: 4/);
  await expect(text).toHaveValue(/Customer: Synthetic Buyer/);
  await expect(text).toHaveValue(/Requested quantity: 500/);
  await expect(text).toHaveValue(/Unit price: USD 12.5/);
  await expect(text).toHaveValue(/Validity start \/ expiry date: Not recorded/);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "复制客户报价文案" }).click();
    await expect(page.getByRole("status").filter({ hasText: "已复制。尚未发送" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await text.inputValue());
  }
  await expect(page.getByRole("button", { name: "核验凭证并登记已发送" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "发送渠道", exact: true })).toBeEmpty();
  await expect(page.getByRole("textbox", { name: "平台消息编号或回执链接" })).toBeEmpty();
  expect(writes).toEqual([]);
});

test("clipboard denial keeps a selectable read-only fallback and permits a retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("Synthetic clipboard denial")) },
    });
  });
  await page.goto(approvedPage);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "复制客户报价文案" }).click();
    await expect(page.getByRole("status").filter({ hasText: "无法访问剪贴板" })).toBeVisible();
    const text = page.getByRole("textbox", { name: "客户报价文案（英文，只读）" });
    await expect(text).toBeFocused();
    expect(await text.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0);
    expect(await text.evaluate((element: HTMLTextAreaElement) => element.selectionEnd)).toBe(
      (await text.inputValue()).length,
    );
  }
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "可直接选中文案复制" })).toBeVisible();
});

test("missing linked data stays unknown and mismatched approvals cannot export", async ({
  page,
}) => {
  await page.goto(approvedPage.replace("quote-approved", "quote-missing-context"));
  const text = page.getByRole("textbox", { name: "客户报价文案（英文，只读）" });
  await expect(text).toHaveValue(/Customer: Not recorded; please confirm/);
  await expect(text).toHaveValue(/Product: Not recorded; please confirm/);
  await expect(text).toHaveValue(/Requested quantity: Not recorded; please confirm/);
  await page.goto(approvedPage.replace("quote-approved", "quote-approval-mismatch"));
  await expect(page.getByText("暂不能生成已批准报价文案", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制客户报价文案" })).toHaveCount(0);
  await page.goBack();
  await expect(text).toHaveValue(/Customer: Not recorded; please confirm/);
  await page.goForward();
  await expect(page.getByRole("button", { name: "复制客户报价文案" })).toHaveCount(0);
  await page.goto(approvedPage.replace("quote-approved", "quote-revision"));
  await expect(page.getByRole("button", { name: "复制客户报价文案" })).toHaveCount(0);
});
