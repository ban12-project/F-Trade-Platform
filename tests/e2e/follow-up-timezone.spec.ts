import { expect, test } from "@playwright/test";

for (const scenario of [
  { zone: "America/New_York", message: "04:30", expiry: "08:00", utc: "2027-02-15T15:30:00.000Z" },
  { zone: "Asia/Shanghai", message: "16:30", expiry: "20:00", utc: "2027-02-15T02:30:00.000Z" },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone });
    test("customer times hydrate consistently and follow-up input preserves the instant", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/testing/project-workflow?kind=sales&record=lead");
      const message = page
        .getByText("Synthetic buyer asks for the verified lead time.", { exact: true })
        .locator("..");
      await expect(message).toContainText(`2026年9月4日 ${scenario.message}（${scenario.zone}）`);
      const date = page.getByLabel("下次跟进时间（可选）", { exact: true });
      await expect(date).toBeEnabled();
      await expect(date).toHaveAccessibleDescription(
        `按当前设备时区（${scenario.zone}）填写；留空并保存可取消提醒。`,
      );
      await page.getByRole("combobox", { name: "当前场景", exact: true }).click();
      await page.getByRole("option", { name: "询问样品", exact: true }).click();
      await expect(page.getByText("交期确认有效至", { exact: false })).toContainText(
        `2027年9月11日 ${scenario.expiry}（${scenario.zone}）`,
      );
      const writes: string[] = [];
      await page.route("**/testing/project-workflow?**", async (route) => {
        if (route.request().method() === "POST") {
          writes.push(route.request().postData() ?? "");
          await route.abort();
        } else await route.continue();
      });
      await date.fill("2027-02-15T10:30");
      await page.getByRole("button", { name: "保存跟进计划", exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toContain(scenario.utc);
      expect(errors.filter((error) => /hydration|server rendered|#418/i.test(error))).toEqual([]);
    });
  });
}
