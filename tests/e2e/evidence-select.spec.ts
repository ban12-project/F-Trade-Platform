import { expect, test } from "@playwright/test";

test("evidence selection uses readable names, validates, submits IDs and resets", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/testing/evidence-select");
  await page.waitForLoadState("networkidle");
  const field = page.getByRole("combobox", { name: "素材使用授权证明" });
  await page.getByRole("button", { name: "保存选择", exact: true }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.click();
  await page.getByRole("option", { name: /合成工厂授权书.pdf · 2026-10-02/ }).click();
  await expect(field).toContainText("合成工厂授权书.pdf");
  await expect(field).not.toContainText("evidence-");
  await page.getByRole("button", { name: "保存选择", exact: true }).click();
  await expect(page.getByLabel("提交结果")).toHaveText("evidence-synthetic-rights-761");
  await page.getByRole("button", { name: "清空选择", exact: true }).click();
  await expect(field).toContainText("请选择已保存的资料");
  await expect(page.getByText("暂无可用资料，请上传文件后选择。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上传资料", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "添加来源资料" })).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("资料文件")).toBeVisible();
  expect(errors).toEqual([]);
});

test("an unauthenticated evidence request has an actionable error and no options", async ({
  page,
}) => {
  await page.goto("/testing/product-media");
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox", { name: "素材使用授权证明" }).click();
  await expect(page.getByRole("option", { name: "暂时无法加载资料" })).toBeDisabled();
  await expect(page.getByText("请重新登录并确认项目权限。", { exact: true })).toBeVisible();
});
