import { expect, test } from "@playwright/test";

test("one public confirmation, multiple targets, blockers, persistence and independent results", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes.push(r.url());
  });
  await page.route("**/api/publication-preview?**", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/testing/publication-batch");
  await page.getByRole("checkbox", { name: /Facebook · Alpha/ }).check();
  await page.getByRole("checkbox", { name: /Facebook · Beta/ }).check();
  await expect(page.getByText("范围：公开（所有人）")).toBeVisible();
  await expect(page.getByText(/共 2 条帖子/)).toBeVisible();
  await expect(page.getByRole("button", { name: "确认公开发布到 2 个账号" })).toBeEnabled();
  await page.getByRole("combobox").selectOption({ label: "合成已审核图片" });
  await expect(page.getByRole("img", { name: "本次发布图片" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Facebook · Login/ }).check();
  await expect(page.getByRole("button", { name: "确认公开发布到 3 个账号" })).toBeDisabled();
  await expect(page.getByText("已发布", { exact: true })).toBeVisible();
  await expect(page.getByText("发布失败", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Facebook · Login/ })).toBeChecked();
  await expect(page.getByRole("img", { name: "本次发布图片" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Facebook · Login/ }).uncheck();
  await page.getByRole("button", { name: "确认公开发布到 2 个账号" }).click();
  await expect(page.getByRole("status")).toContainText("登录已失效");
  expect(writes).toHaveLength(1);
  await expect(page.getByRole("checkbox", { name: /Facebook · Alpha/ })).toBeChecked();
});
