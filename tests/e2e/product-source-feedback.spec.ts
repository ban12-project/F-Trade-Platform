import { expect, test } from "@playwright/test";

test("product source explains invalid files and recovers after replacement and clearing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/project-workflow?record=product");
  const file = page.getByLabel("产品资料", { exact: true });
  await expect(file).toBeEnabled();
  await file.setInputFiles({
    name: "synthetic-empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  await expect(file).toHaveAttribute("aria-invalid", "true");
  await expect(file).toHaveAccessibleDescription(/支持 PDF.*25 MiB.*文件为空/);
  await file.setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic"),
  });
  await expect(file).toHaveAccessibleDescription(/只支持 PDF、CSV、XLS 和 XLSX 文件/);
  const filename = `synthetic-${"catalogue".repeat(24)}.csv`;
  await file.setInputFiles({
    name: filename,
    mimeType: "text/csv",
    buffer: Buffer.from("name\nsynthetic"),
  });
  await expect(file).toHaveAttribute("aria-invalid", "false");
  await expect(file).toHaveAccessibleDescription(/支持 PDF.*25 MiB/);
  await expect(page.getByText(`已选择：${filename}`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await file.setInputFiles([]);
  await expect(file).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator('[data-slot="field-error"]')).toHaveCount(0);
  await expect(file).toHaveAccessibleDescription(/支持 PDF.*25 MiB/);
});
