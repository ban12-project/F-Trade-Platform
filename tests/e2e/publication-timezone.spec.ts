import { expect, test } from "@playwright/test";

for (const scenario of [
  {
    zone: "America/New_York",
    created: "2026年10月31日 20:00:00",
    published: "2026年10月31日 20:01:00",
  },
  { zone: "Asia/Shanghai", created: "2026年11月1日 08:00:00", published: "2026年11月1日 08:01:00" },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone, locale: "en-US", viewport: { width: 390, height: 844 } });
    test("publication history preserves exact instants without hydration errors or writes", async ({
      page,
    }) => {
      const errors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.method() === "POST") writes.push(request.url());
      });
      await page.goto("/testing/publication-batch");
      const alpha = page
        .locator('[data-slot="card"]')
        .filter({ visible: true })
        .filter({
          has: page.locator('[data-slot="card-description"]').getByText("Alpha", { exact: true }),
        });
      await expect(alpha.locator('time[datetime="2026-11-01T00:00:00.000Z"]')).toHaveText(
        `${scenario.created}（${scenario.zone}）`,
      );
      await expect(alpha.locator('time[datetime="2026-11-01T00:01:00.000Z"]')).toHaveText(
        `${scenario.published}（${scenario.zone}）`,
      );
      await expect(alpha).toContainText("提交时间：");
      await expect(alpha).toContainText("发布时间：");
      const beta = page
        .locator('[data-slot="card"]')
        .filter({ visible: true })
        .filter({
          has: page.locator('[data-slot="card-description"]').getByText("Beta", { exact: true }),
        });
      await expect(beta.getByText("发布时间：", { exact: false })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    });
  });
}
