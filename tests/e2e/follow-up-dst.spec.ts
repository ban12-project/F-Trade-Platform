import { expect, test } from "@playwright/test";

for (const scenario of [
  {
    zone: "America/New_York",
    gap: "2027-03-14T02:30",
    valid: "2027-03-14T03:30",
    utc: "2027-03-14T07:30:00.000Z",
  },
  {
    zone: "Australia/Lord_Howe",
    gap: "2027-10-03T02:15",
    valid: "2027-10-03T02:45",
    utc: "2027-10-02T15:45:00.000Z",
  },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone });
    for (const mode of ["保存跟进计划", "人工确认并发送此回复"]) {
      test(`${mode} rejects a nonexistent local time and preserves edits`, async ({ page }) => {
        await page.goto("/testing/project-workflow?kind=sales&record=lead");
        const writes: string[] = [];
        await page.route("**/testing/project-workflow?**", async (route) => {
          if (route.request().method() === "POST") {
            writes.push(route.request().postData() ?? "");
            await route.abort();
          } else await route.continue();
        });
        const date = page.getByLabel("下次跟进时间（可选）", { exact: true });
        const draft = page.getByLabel("待人工发送内容", { exact: true });
        await draft.fill("SYNTHETIC draft preserved across invalid local time");
        await date.fill(scenario.gap);
        const submit = page.getByRole("button", { name: mode, exact: true });
        await submit.click();
        await expect(date).toHaveValue(scenario.gap);
        await expect(date).toBeFocused();
        await expect(date).toHaveAccessibleDescription(/此时间在当前设备时区中不存在或无效/);
        await expect(draft).toHaveValue("SYNTHETIC draft preserved across invalid local time");
        expect(writes).toEqual([]);
        await date.fill(scenario.valid);
        await expect(date).toHaveAttribute("aria-invalid", "false");
        await expect(date).not.toHaveAccessibleDescription(/不存在或无效/);
        await submit.click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toContain(scenario.utc);
      });
    }
  });
}
