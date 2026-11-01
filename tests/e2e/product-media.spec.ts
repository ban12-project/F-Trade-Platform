import { expect, test } from "@playwright/test";

test("ProductMedia workspace exposes governed rights, review, and VideoReady state", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto("/testing/product-media");
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("可制作视频", { exact: true })).toBeVisible();
  await expect(page.getByText("添加产品图片或视频", { exact: true })).toBeVisible();
  await expect(page.getByLabel("图片或视频")).toHaveAttribute("accept", /video\/mp4/);
  await expect(page.getByRole("checkbox", { name: "允许剪辑" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "允许公开发布" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "允许图生视频" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "上传素材并提交审核" })).toBeDisabled();

  const assetCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Authorized front-facing synthetic product image." });
  await expect(assetCard.getByText("产品主图", { exact: true })).toBeVisible();
  await expect(assetCard.getByText("1600×1600")).toBeVisible();
  await expect(assetCard.getByText("图生视频授权", { exact: true })).toBeVisible();
  await expect(
    assetCard.getByText("视频生成服务仍保持关闭；授权记录本身不会触发模型调用。", { exact: true }),
  ).toBeVisible();
  await expect(assetCard.getByRole("button", { name: "撤销素材授权" })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
