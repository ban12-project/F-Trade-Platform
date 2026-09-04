import { expect, test } from "@playwright/test";

test("accepts, deduplicates, and retries a synthetic official webhook", async ({ page }) => {
  await page.goto("/testing/mock-channel");
  await expect(page.getByRole("heading", { name: "Mock official channel 验收" })).toBeVisible();

  await page.getByRole("button", { name: "重置 mock 场景" }).click();
  await expect(page.getByRole("status")).toContainText("已接受动作：0");

  await page.getByRole("button", { name: "投递 synthetic webhook" }).click();
  await expect(page.getByRole("status")).toContainText(
    "状态：accepted；下一步：create_or_update_lead；已接受动作：1",
  );

  await page.getByRole("button", { name: "重发相同 webhook" }).click();
  await expect(page.getByRole("status")).toContainText(
    "状态：duplicate；下一步：ignore_duplicate；已接受动作：1",
  );

  await page.getByRole("button", { name: "模拟下游失败" }).click();
  await expect(page.getByRole("status")).toContainText(
    "状态：rejected；下一步：none；已接受动作：1；原因：synthetic_downstream_failure",
  );

  await page.getByRole("button", { name: "重试失败 webhook" }).click();
  await expect(page.getByRole("status")).toContainText(
    "状态：accepted；下一步：create_or_update_lead；已接受动作：2",
  );
});
