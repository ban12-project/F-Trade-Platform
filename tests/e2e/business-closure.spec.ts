import { expect, test } from "@playwright/test";

test("synthetic browser acceptance reaches opportunity through every human gate", async ({
  page,
}) => {
  await page.goto("/testing/business-closure");
  await expect(page.getByRole("heading", { name: "业务闭环验收" })).toBeVisible();
  await expect(page.getByText("纯合成数据", { exact: true })).toBeVisible();
  for (const state of [
    "PRODUCT_READY",
    "CONTENT_PUBLISHED",
    "VIDEO_APPROVED",
    "RFQ_READY",
    "QUOTE_SENT",
    "DELIVERY_CONFIRMATION_CONFIRMED",
  ] as const)
    await expect(page.getByText(state, { exact: true })).toBeVisible();
  await expect(page.getByText("签名回执 · succeeded", { exact: true })).toBeVisible();
  await expect(page.getByText("发送窗口已重新校验", { exact: true })).toBeVisible();
  await expect(page.getByText("验收终点：OPPORTUNITY", { exact: true })).toBeVisible();
});
