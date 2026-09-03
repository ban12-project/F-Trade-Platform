import { expect, test } from "@playwright/test";

test("marketing video creation reuses approved ProductMedia without repeating rights evidence", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });

  await page.goto("/testing/video-product-media-create");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "复用产品媒体" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("当前产品有 2 个可复用媒体。")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /产品主图/ })).toBeChecked();
  await expect(page.getByText("1600×1600", { exact: true })).toBeVisible();
  await expect(page.getByText("4.5 秒", { exact: false })).toBeVisible();
  await expect(page.getByLabel("素材（1–3 个）")).toHaveCount(0);
  await expect(page.getByLabel("素材权利证据")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "复用媒体并生成 AI 初稿" })).toBeEnabled();

  await page.getByRole("button", { name: "上传新素材" }).click();
  await expect(page.getByLabel("素材（1–3 个）")).toBeVisible();
  await expect(page.getByLabel("素材权利证据")).toBeVisible();
  await expect(page.getByRole("button", { name: "上传并生成 AI 初稿" })).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test("switching to a product without reusable media falls back to upload", async ({ page }) => {
  await page.goto("/testing/video-product-media-create");
  await page.waitForLoadState("networkidle");

  const product = page.getByRole("combobox").first();
  await product.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "Verified clutch disc · SYN-904" }).click();

  await expect(page.getByRole("button", { name: "上传新素材" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "复用产品媒体" })).toBeDisabled();
  await expect(page.getByText("当前产品没有审核通过且仍在授权期内的可复用媒体。")).toBeVisible();
  await expect(page.getByLabel("素材权利证据")).toBeVisible();
});
