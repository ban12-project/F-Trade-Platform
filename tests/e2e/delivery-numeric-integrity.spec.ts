import { expect, test } from "@playwright/test";

test("delivery approval rejects unsafe days, preserves input, and keeps rejection independent", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?kind=sales&record=delivery&state=delivery-pending");
  const form = page.locator('form[id^="delivery-"]');
  const decisionGroup = form.getByRole("radiogroup", { name: "决定", exact: true });
  await decisionGroup.getByRole("radio", { name: "确认交期", exact: true }).click();
  await form.getByRole("combobox", { name: "审核依据", exact: true }).click();
  await page.getByRole("option", { name: "合成审核记录.pdf", exact: true }).click();
  const days = form.getByLabel("确认交期（天）", { exact: true });
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  for (const invalid of ["9007199254740993", "9".repeat(400)]) {
    await days.fill(invalid);
    await page.getByRole("button", { name: "确认人工交期", exact: true }).click();
    await expect(days).toHaveValue(invalid);
    await expect(days).toHaveAttribute("aria-invalid", "true");
    await expect(
      form.getByText("交期超出可准确保存的整数范围，请核对。", { exact: true }),
    ).toBeVisible();
  }
  await days.fill("0");
  await expect(days).toHaveAttribute("aria-invalid", "false");
  await days.fill("9007199254740993");
  await decisionGroup.getByRole("radio", { name: "拒绝确认", exact: true }).click();
  await page.getByRole("button", { name: "拒绝交期确认", exact: true }).click();
  await expect(days).toBeDisabled();
  await expect(days).toHaveAttribute("aria-invalid", "false");
  await expect(
    form.getByText("交期超出可准确保存的整数范围，请核对。", { exact: true }),
  ).toHaveCount(0);
  await expect(form.getByText("拒绝交期确认时必须填写原因。", { exact: true })).toBeVisible();
  expect(posts).toEqual([]);
});
