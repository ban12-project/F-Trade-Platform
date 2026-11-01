import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("same MP4 caption selection preserves exact preview without extra confirmation", async ({
  page,
}) => {
  await page.route("**/api/publication-preview?*", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "video/webm",
      body: await readFile("tests/fixtures/synthetic-publication-preview.webm"),
    }),
  );
  await page.goto("/testing/video-publication-caption");
  const media = page.getByLabel("正文与素材");
  const confirm = page.getByRole("checkbox");
  await media.selectOption({ label: "SYNTHETIC 视频 · 无配文" });
  await expect(page.getByText("已批准 MP4 成片；无附加文案。", { exact: false })).toBeVisible();
  await confirm.check();
  await media.selectOption({ label: "SYNTHETIC 视频 · 已审核配文" });
  await expect(confirm).toBeChecked();
  await expect(
    page.getByText("SYNTHETIC approved caption; no factory claims.", { exact: false }),
  ).toBeVisible();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  expect(writes).toHaveLength(0);
  await media.selectOption({ label: "SYNTHETIC 视频 · 无配文" });
  await expect(confirm).toBeChecked();
  await expect(page.getByText("SYNTHETIC approved caption; no factory claims.")).toHaveCount(0);
  await media.selectOption({ label: "SYNTHETIC 视频 · 已审核配文" });
  await confirm.check();
  await page.getByRole("button", { name: "确认公开发布到 1 个账号" }).click();
  await expect(page.getByRole("status")).toContainText("登录已失效");
  expect(writes).toHaveLength(1);
});
