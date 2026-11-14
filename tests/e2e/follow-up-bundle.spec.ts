import { expect, test } from "@playwright/test";

test("quotation skips timezone code and follow-up loads it when rendered", async ({ page }) => {
  const timezoneChunks: string[] = [];
  const responses: Promise<void>[] = [];
  page.on("response", (response) => {
    if (!response.url().includes("/_next/static/") || !response.url().endsWith(".js")) return;
    responses.push(
      response.text().then((source) => {
        // Stable library error text identifies the production chunk without a hashed filename.
        if (source.includes("Temporal.Instant requires a time zone offset"))
          timezoneChunks.push(response.url());
      }),
    );
  });
  await page.goto("/testing/project-workflow?kind=sales&record=quotation");
  await page.waitForLoadState("networkidle");
  await Promise.all(responses);
  expect(timezoneChunks).toEqual([]);

  await page.goto("/testing/project-workflow?kind=sales&record=lead");
  await expect(page.getByLabel("下次跟进时间（可选）", { exact: true })).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await Promise.all(responses);
  expect(timezoneChunks.length).toBeGreaterThan(0);
});
