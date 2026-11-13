import { expect, test } from "@playwright/test";

for (const scenario of [
  { zone: "America/New_York", inbound: "2026年9月2日 22:00", expiry: "2027年9月11日 08:00" },
  { zone: "Pacific/Kiritimati", inbound: "2026年9月3日 16:00", expiry: "2027年9月12日 02:00" },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone, viewport: { width: 390, height: 844 } });
    for (const route of ["inbound", "delivery"] as const) {
      test(`${route} displays an explicit local instant without hydration recovery`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(
          route === "inbound"
            ? "/testing/workspace-dashboard"
            : "/testing/project-workflow?kind=sales&record=delivery",
        );
        const target =
          route === "inbound"
            ? page.getByRole("region", { name: "待分流入站消息", exact: true })
            : page.getByText("工厂确认交期：", { exact: false });
        await expect(target).toContainText(
          `${scenario[route === "inbound" ? "inbound" : "expiry"]}（${scenario.zone}）`,
        );
        if (route === "delivery")
          await expect(target).toContainText("是否可用于回复以当前有效性检查为准");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
      });
    }
  });
}
