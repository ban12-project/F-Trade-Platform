import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });
for (const scenario of [
  {
    state: "lead-time-precision",
    local: "2027-11-06T02:30",
    instant: "2027-11-06T06:30:45.123Z",
    fold: false,
  },
  {
    state: "lead-fold-precision",
    local: "2027-11-07T01:30",
    instant: "2027-11-07T06:30:45.123Z",
    fold: true,
  },
]) {
  for (const mode of ["保存跟进计划", "人工确认并发送此回复"]) {
    test(`${scenario.state} preserves seconds and milliseconds through ${mode}`, async ({
      page,
    }) => {
      await page.goto(`/testing/project-workflow?kind=sales&record=lead&state=${scenario.state}`);
      await expect(page.getByLabel("下次跟进时间（可选）", { exact: true })).toHaveValue(
        scenario.local,
      );
      if (scenario.fold)
        await expect(page.getByRole("combobox", { name: "重复时间选择", exact: true })).toHaveValue(
          scenario.instant,
        );
      await page
        .getByLabel("待人工发送内容", { exact: true })
        .fill("SYNTHETIC precision-preserving reply");
      await page.getByRole("checkbox", { name: "提供 OE", exact: true }).check();
      const writes: string[] = [];
      await page.route("**/testing/project-workflow?**", async (route) => {
        if (route.request().method() === "POST") {
          writes.push(route.request().postData() ?? "");
          await route.abort();
        } else await route.continue();
      });
      await page.getByRole("button", { name: mode, exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toContain(scenario.instant);
    });
  }
}

test("editing a saved precise minute resolves the newly entered minute", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&record=lead&state=lead-time-precision");
  await page.getByLabel("下次跟进时间（可选）", { exact: true }).fill("2027-11-06T02:31");
  const writes: string[] = [];
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postData() ?? "");
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "保存跟进计划", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toContain("2027-11-06T06:31:00.000Z");
  expect(writes[0]).not.toContain("06:30:45.123Z");
});
