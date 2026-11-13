import { expect, test } from "@playwright/test";
import { nodeTimestamp, syntheticBrowserNodes } from "../fixtures/browser-nodes";

for (const scenario of [
  { zone: "America/New_York", date: "2026年12月31日", time: "19:30:15" },
  { zone: "Pacific/Kiritimati", date: "2027年1月1日", time: "14:30:15" },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone, viewport: { width: 390, height: 844 } });
    test("node and inbox times name their device timezone and preserve unknown states", async ({
      page,
    }) => {
      const requests: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/testing/browser-nodes", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        requests.push(route.request().postData() ?? "");
        await route.fulfill({
          contentType: "text/x-component",
          body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(syntheticBrowserNodes())}\n`,
        });
      });
      await page.goto("/testing/browser-nodes");
      const observed = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByText("合成已连接服务", { exact: false }) });
      const times = observed.locator("time");
      await expect(times).toHaveCount(2);
      for (const time of await times.all()) {
        await expect(time).toHaveAttribute("datetime", nodeTimestamp);
        await expect(time).toContainText(scenario.date);
        await expect(time).toContainText(scenario.time);
        await expect(time).toContainText(scenario.zone);
      }
      const unknown = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByText("合成未连接服务", { exact: false }) });
      await expect(unknown).toContainText("尚未连接");
      await expect(unknown).toContainText("尚未执行");
      await expect(unknown.locator("time")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((body) => body === "[]")).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}
