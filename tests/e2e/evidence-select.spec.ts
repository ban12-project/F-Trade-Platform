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

test("upload explains invalid files, retains failed files and allows retry", async ({ page }) => {
  await page.goto("/testing/evidence-select");
  await page.getByRole("button", { name: "上传资料", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "添加来源资料" });
  const file = dialog.getByLabel("资料文件", { exact: true });
  const save = dialog.getByRole("button", { name: "保存到项目资料库", exact: true });
  let uploads = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/product-documents/upload", async (route) => {
    uploads += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ status: 403, json: { error: "SYNTHETIC upload denied" } });
  });
  await file.setInputFiles({
    name: "synthetic-empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  await save.click();
  await expect(file).toHaveAccessibleDescription(/支持 PDF.*文件为空，请选择包含资料内容的文件。/);
  await expect(file).toBeFocused();
  await file.setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("SYNTHETIC"),
  });
  await save.click();
  await expect(file).toHaveAccessibleDescription(/只支持 PDF、CSV、XLS 和 XLSX 文件。/);
  expect(uploads).toBe(0);
  await file.setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("SYNTHETIC,value\nexample,1"),
  });
  await expect(file).toHaveAttribute("aria-invalid", "false");
  await expect(file).toHaveAccessibleDescription(
    "支持 PDF、CSV、XLS、XLSX，最大 25 MiB；文件保存在私有存储。",
  );
  for (let attempt = 1; attempt <= 2; attempt++) {
    await save.click();
    await expect.poll(() => uploads).toBe(attempt);
    await expect(dialog.getByRole("button", { name: /正在上传并保存资料…/ })).toBeDisabled();
    await expect(file).toBeDisabled();
    release?.();
    await expect(
      dialog.getByText("文件上传失败，请检查文件与项目权限后重试。", { exact: true }),
    ).toBeVisible();
    await expect(save).toBeEnabled();
    expect(await file.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
      "synthetic.csv",
    );
  }
});
