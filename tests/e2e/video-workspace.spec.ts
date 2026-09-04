
import { expect, test } from "@playwright/test";

test("video editor opens the selected draft in a dedicated workspace", async ({ page }) => {
  await page.goto("/testing/video-workspace");
  await expect(page.getByRole("heading", { name: "视频编辑器" })).toBeVisible();
  await expect(page.getByText("最长 15 秒")).toBeVisible();
  await expect(page.getByText("8.0 / 15 秒")).toBeVisible();
});

test("video editor blocks a draft longer than 15 seconds", async ({ page }) => {
  await page.goto("/testing/video-workspace");
  const durations = page.getByLabel("成片时长（秒）");
  await durations.nth(0).fill("10");
  await durations.nth(1).fill("10");
  await expect(page.getByText("视频过长")).toBeVisible();
  await expect(page.getByRole("button", { name: "合成预览" })).toBeDisabled();
});

test("verified captions remain server controlled", async ({ page }) => {
  await page.goto("/testing/video-workspace");
  await page.getByLabel("字幕类型").first().selectOption("creative");
  await page.getByLabel("创意字幕").fill("OE 99999");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("创意文案不能包含工程或商业事实；请改用核验事实字段。")).toBeVisible();
  await page.getByLabel("字幕类型").first().selectOption("verified_fact");
  await expect(page.getByLabel("事实字段")).toContainText("product.product_name · Verified clutch kit");
});

test("returning to the project protects an unsaved video draft", async ({ page }) => {
  await page.goto("/testing/video-workspace");
  await page.getByLabel("成片时长（秒）").first().fill("6");
  await page.getByRole("link", { name: "返回营销视频步骤" }).click();
  const alert = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/\/testing\/video-workspace/);
});

test("video workspace exposes upload and post-render review without generation controls", async ({ page }) => {
  await page.goto("/testing/video-workspace");
  await page.getByRole("button", { name: "新建" }).click();
  await expect(page.getByLabel("素材（1–3 个）")).toHaveAttribute("accept", /video\/mp4/);
  await expect(page.getByLabel("素材权利证据")).toBeVisible();
  await expect(page.getByText("不会调用视频生成模型")).toBeVisible();
  await expect(page.getByRole("button", { name: /生成视频|模型配置|供应商/ })).toHaveCount(0);

  await page.goto("/testing/video-workspace?state=review");
  await expect(page.getByText("私有预览", { exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("src", /\/api\/video-preview\/asset-rendered-preview-001$/);
});
