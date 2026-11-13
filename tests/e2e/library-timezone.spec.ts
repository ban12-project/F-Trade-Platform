import { expect, test } from "@playwright/test";

for (const scenario of [
  { zone: "America/New_York", local: "2025年12月31日 19:30" },
  { zone: "Pacific/Kiritimati", local: "2026年1月1日 14:30" },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone, viewport: { width: 390, height: 844 } });
    test("library submission time is explicit, local and read-only", async ({ page }) => {
      const errors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.method() === "POST") writes.push(request.url());
      });
      await page.goto("/testing/workspace-library/content");
      const history = page.getByRole("list", { name: "Synthetic content的发布情况" });
      await expect(history.locator("time")).toHaveText(
        `提交时间：${scenario.local}（${scenario.zone}）`,
      );
      await expect(history.locator("time")).toHaveAttribute("datetime", "2026-01-01T00:30:00.000Z");
      await expect(history).toContainText("发布失败");
      const account = history.getByText("Synthetic publication account", { exact: true });
      expect((await account.boundingBox())?.height).toBeLessThanOrEqual(40);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    });
  });
}

test.describe("server timestamp", () => {
  test.use({ javaScriptEnabled: false, timezoneId: "America/New_York" });
  test("server-rendered history identifies UTC before hydration", async ({ page }) => {
    await page.goto("/testing/workspace-library/content");
    await expect(page.locator('time[datetime="2026-01-01T00:30:00.000Z"]')).toHaveText(
      "提交时间：2026年1月1日 00:30（UTC）",
    );
  });
});
