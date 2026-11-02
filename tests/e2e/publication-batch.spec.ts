import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/publication-preview?**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/testing/publication-batch");
});

test("results associate each status with its account", async ({ page }) => {
  const results = page.getByRole("main");
  const alpha = results.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-description"]').getByText("Alpha", { exact: true }),
  });
  const beta = results.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-description"]').getByText("Beta", { exact: true }),
  });
  await expect(alpha).toHaveCount(1);
  await expect(alpha.getByText("已发布", { exact: true })).toBeVisible();
  await expect(alpha.getByRole("link", { name: "查看平台帖子" })).toHaveAttribute(
    "href",
    "https://www.facebook.com/synthetic/posts/1",
  );
  await expect(beta).toHaveCount(1);
  await expect(beta.getByText("发布失败", { exact: true })).toBeVisible();
  await expect(beta.getByRole("link", { name: "查看平台帖子" })).toHaveCount(0);
});

test("unavailable accounts block public confirmation without a write", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes.push(r.url());
  });
  await page.getByRole("checkbox", { name: /Facebook · Alpha/ }).check();
  await page.getByRole("checkbox", { name: /Facebook · Beta/ }).check();
  await expect(page.getByText("范围：公开（所有人）")).toBeVisible();
  await expect(page.getByText(/共 2 条帖子/)).toBeVisible();
  await expect(page.getByRole("button", { name: "确认公开发布到 2 个账号" })).toBeEnabled();
  await page.getByRole("checkbox", { name: /Facebook · Login/ }).check();
  await expect(page.getByRole("button", { name: "确认公开发布到 3 个账号" })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test("media and account selections survive reload", async ({ page }) => {
  await page.getByRole("checkbox", { name: /Facebook · Alpha/ }).check();
  await page.getByRole("combobox").selectOption({ label: "合成已审核图片" });
  await expect(page.getByRole("img", { name: "本次发布图片" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Facebook · Alpha/ })).toBeChecked();
  await expect(page.getByRole("img", { name: "本次发布图片" })).toBeVisible();
});

test("expired authentication rejects one submission and retains selection", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) writes.push(r.url());
  });
  await page.getByRole("checkbox", { name: /Facebook · Alpha/ }).check();
  await page.getByRole("checkbox", { name: /Facebook · Beta/ }).check();
  await page.getByRole("button", { name: "确认公开发布到 2 个账号" }).click();
  await expect(page.getByRole("status")).toContainText("登录已失效");
  expect(writes).toHaveLength(1);
  await expect(page.getByRole("checkbox", { name: /Facebook · Alpha/ })).toBeChecked();
});
