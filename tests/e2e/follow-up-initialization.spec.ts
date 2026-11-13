import { expect, test } from "@playwright/test";

test("follow-up waits for initialization and keeps the first reply and plan edits", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await held;
    await route.continue();
  });
  const form = page.locator('form[id^="follow-up-"]');
  const draft = form.getByLabel("待人工发送内容", { exact: true });
  const context = form.getByRole("combobox", { name: "当前场景", exact: true });
  const plan = page.getByRole("button", { name: "保存跟进计划", exact: true });
  const send = page.getByRole("button", { name: "人工确认并发送此回复", exact: true });
  try {
    await page.goto("/testing/project-workflow?kind=sales&record=lead", { waitUntil: "commit" });
    await expect(draft).toBeVisible();
    await expect(draft).toBeDisabled();
    await expect(context).toBeDisabled();
    await expect(plan).toBeDisabled();
    await expect(send).toBeDisabled();
    await expect(form).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(draft).toBeEnabled();
  await draft.fill("SYNTHETIC first reply retained");
  await context.click();
  await page.getByRole("option", { name: "已读未回复", exact: true }).click();
  await expect(draft).toHaveValue("SYNTHETIC first reply retained");
  await expect(context).toContainText("已读未回复");
  await expect(plan).toBeEnabled();
  await expect(form).toHaveAttribute("aria-busy", "false");
});
