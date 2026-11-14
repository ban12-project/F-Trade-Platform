import { expect, test } from "@playwright/test";

for (const scenario of [
  {
    zone: "America/New_York",
    local: "2027-11-07T01:30",
    earlier: "2027-11-07T05:30:00.000Z",
    later: "2027-11-07T06:30:00.000Z",
  },
  {
    zone: "Australia/Lord_Howe",
    local: "2027-04-04T01:45",
    earlier: "2027-04-03T14:45:00.000Z",
    later: "2027-04-03T15:15:00.000Z",
  },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone, viewport: { width: 390, height: 844 } });
    for (const mode of ["保存跟进计划", "人工确认并发送此回复"]) {
      test(`${mode} requires an explicit repeated-time choice`, async ({ page }) => {
        await page.goto("/testing/project-workflow?kind=sales&record=lead");
        const writes: string[] = [];
        await page.route("**/testing/project-workflow?**", async (route) => {
          if (route.request().method() === "POST") {
            writes.push(route.request().postData() ?? "");
            await route.abort();
          } else await route.continue();
        });
        await page
          .getByLabel("待人工发送内容", { exact: true })
          .fill("SYNTHETIC repeated-time reply");
        const date = page.getByLabel("下次跟进时间（可选）", { exact: true });
        await date.fill(scenario.local);
        const choice = page.getByRole("combobox", { name: "重复时间选择", exact: true });
        await expect(choice).toHaveValue("");
        await page.getByRole("button", { name: mode, exact: true }).click();
        await expect(choice).toBeFocused();
        await expect(choice).toHaveAccessibleDescription(/此本地时间出现两次，请选择具体时刻/);
        expect(writes).toEqual([]);
        await choice.selectOption(scenario.earlier);
        await expect(choice).toHaveAttribute("aria-invalid", "false");
        await date.fill("2027-02-15T10:30");
        await expect(choice).toHaveCount(0);
        await date.fill(scenario.local);
        await expect(choice).toHaveValue("");
        const chosen = mode === "保存跟进计划" ? scenario.earlier : scenario.later;
        await choice.selectOption(chosen);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.getByRole("button", { name: mode, exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toContain(chosen);
        expect(writes[0]).not.toContain("selectedInstant");
      });
    }
  });
}

test.describe("saved later occurrence", () => {
  test.use({ timezoneId: "America/New_York" });
  test("editing other plan fields preserves the saved later instant", async ({ page }) => {
    await page.goto("/testing/project-workflow?kind=sales&record=lead&state=lead-fold-later");
    const choice = page.getByRole("combobox", { name: "重复时间选择", exact: true });
    await expect(choice).toHaveValue("2027-11-07T06:30:00.000Z");
    await expect(page.getByLabel("下次跟进时间（可选）", { exact: true })).toHaveValue(
      "2027-11-07T01:30",
    );
    await page.getByRole("combobox", { name: "当前场景", exact: true }).click();
    await page.getByRole("option", { name: "反馈价格高", exact: true }).click();
    const writes: string[] = [];
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() === "POST") {
        writes.push(route.request().postData() ?? "");
        await route.abort();
      } else await route.continue();
    });
    await page.getByRole("button", { name: "保存跟进计划", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toContain("2027-11-07T06:30:00.000Z");
  });
});
