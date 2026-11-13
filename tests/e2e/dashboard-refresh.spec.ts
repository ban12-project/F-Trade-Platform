import { expect, test } from "@playwright/test";

test("task refresh reclassifies due work and preserves the active view without writes", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setExtraHTTPHeaders({ "x-testing-dashboard-time": "2026-09-04T00:00:00Z" });
  await page.goto("/testing/workspace-dashboard?offline=1&view=actionable");
  const followUp = page
    .getByRole("link")
    .filter({ hasText: "下一动作：收集样品需求，交由人工确认。" });
  await expect(followUp).toHaveCount(0);
  const timestamp = page.locator("header time");
  await expect(timestamp).toHaveAttribute("datetime", "2026-09-04T00:00:00.000Z");
  await context.setExtraHTTPHeaders({ "x-testing-dashboard-time": "2026-09-06T00:00:00Z" });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  let writes = 0;
  await page.route("**/testing/workspace-dashboard?**", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      return route.abort();
    }
    if (
      route.request().headers().rsc === "1" &&
      !route.request().headers()["next-router-prefetch"]
    ) {
      reads++;
      await held;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "刷新任务", exact: true }).click();
    await expect.poll(() => reads).toBe(1);
    await expect(page.getByRole("button", { name: "正在刷新任务…", exact: true })).toBeDisabled();
    await expect(timestamp).toHaveAttribute("datetime", "2026-09-04T00:00:00.000Z");
    await expect(page.getByRole("heading", { name: "我可处理", exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(followUp).toBeVisible();
  await expect(followUp).toContainText("已逾期");
  await expect(timestamp).toHaveAttribute("datetime", "2026-09-06T00:00:00.000Z");
  await expect(page.getByRole("button", { name: "刷新任务", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/offline=1&view=actionable$/);
  expect(writes).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
