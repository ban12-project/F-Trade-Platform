import { expect, test } from "@playwright/test";

test("partial follow-up dates never dispatch cancellation and can be corrected", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?kind=sales&record=lead");
  const writes: string[] = [];
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postData() ?? "");
      await route.abort();
    } else await route.continue();
  });
  const date = page.getByLabel("下次跟进时间（可选）", { exact: true });
  const save = page.getByRole("button", { name: "保存跟进计划", exact: true });
  await expect(date).toBeEnabled();
  await date.focus();
  await expect(date).toBeFocused();
  await date.press("ArrowUp");
  await expect
    .poll(() => date.evaluate((element: HTMLInputElement) => element.validity.badInput))
    .toBe(true);
  await expect(date).toHaveValue("");
  await save.click();
  await expect(date).toBeFocused();
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(date).toHaveAccessibleDescription(/请填写完整有效的跟进时间，或清空以取消提醒。/);
  expect(writes).toEqual([]);
  await date.fill("2027-02-15T10:30");
  await expect(date).toHaveAttribute("aria-invalid", "false");
  await expect(date).not.toHaveAccessibleDescription(/请填写完整有效/);
  await save.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toContain("2027-02-15");
});

test("an explicitly empty follow-up date still saves reminder cancellation", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&record=lead");
  const writes: string[] = [];
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postData() ?? "");
      await route.abort();
    } else await route.continue();
  });
  const date = page.getByLabel("下次跟进时间（可选）", { exact: true });
  await date.fill("2027-02-15T10:30");
  await date.fill("");
  await expect
    .poll(() => date.evaluate((element: HTMLInputElement) => element.validity.valid))
    .toBe(true);
  await page.getByRole("button", { name: "保存跟进计划", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toContain("2027-02-15");
});

test("clearing a partial date removes its error even when the serialized value stays empty", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?kind=sales&record=lead");
  let writes = 0;
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      await route.abort();
    } else await route.continue();
  });
  const date = page.getByLabel("下次跟进时间（可选）", { exact: true });
  const save = page.getByRole("button", { name: "保存跟进计划", exact: true });
  await expect(date).toBeEnabled();
  await date.focus();
  await expect(date).toBeFocused();
  await date.press("ArrowUp");
  await expect
    .poll(() => date.evaluate((element: HTMLInputElement) => element.validity.badInput))
    .toBe(true);
  await save.click();
  await expect(date).toBeFocused();
  await expect(date).toHaveAttribute("aria-invalid", "true");
  expect(writes).toBe(0);
  await date.press("Backspace");
  await expect
    .poll(() => date.evaluate((element: HTMLInputElement) => element.validity.valid))
    .toBe(true);
  await expect(date).toHaveValue("");
  await expect(date).toHaveAttribute("aria-invalid", "false");
  await expect(date).toHaveAccessibleDescription(/按当前设备时区/);
  await expect(date).not.toHaveAccessibleDescription(/请填写完整有效/);
  await save.click();
  await expect.poll(() => writes).toBe(1);
});
