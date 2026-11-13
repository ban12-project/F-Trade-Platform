import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`${theme} evidence keyboard flow and validation states have no detected WCAG violations`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    let writes = 0;
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST") {
        writes++;
        await route.abort();
      } else await route.continue();
    });
    async function audit(state: string) {
      await page.evaluate(async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await document.fonts.ready;
        await Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      }, theme);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach(`${theme}-${state}`, {
        body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }),
        contentType: "application/json",
      });
      expect(
        result.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      ).toEqual([]);
    }
    await page.goto("/testing/evidence-select");
    const field = page.getByRole("combobox", { name: "素材使用授权证明", exact: true });
    await field.focus();
    await field.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(field).toHaveAttribute(
      "aria-controls",
      (await page.getByRole("listbox").getAttribute("id")) ?? "",
    );
    await audit("open-options");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(field).toHaveAccessibleDescription(/已选择：synthetic-catalogue.*2026-10-04/);
    await expect(field).toBeFocused();
    await audit("selected-long-label");
    const upload = page.getByRole("button", { name: "上传资料", exact: true }).first();
    await upload.focus();
    await upload.press("Enter");
    const dialog = page.getByRole("dialog", { name: "添加来源资料", exact: true });
    const file = dialog.getByLabel("资料文件", { exact: true });
    await file.setInputFiles({
      name: "synthetic-empty.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(0),
    });
    await dialog.getByRole("button", { name: "保存到项目资料库", exact: true }).click();
    await expect(file).toBeFocused();
    await expect(file).toHaveAccessibleDescription(/文件为空/);
    await audit("upload-error");
    for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(upload).toBeFocused();
    await expect(field).toHaveAccessibleDescription(/2026-10-04/);
    await page.goto("/testing/project-workflow?record=product");
    const source = page.getByLabel("产品资料", { exact: true });
    await expect(source).toBeEnabled();
    await source.setInputFiles({
      name: "synthetic-empty.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(0),
    });
    await expect(source).toHaveAccessibleDescription(/文件为空/);
    await audit("product-source-error");
    expect(writes).toBe(0);
  });
}
