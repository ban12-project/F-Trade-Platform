import { expect, test } from "@playwright/test";

test("same MP4 caption selection resets confirmation and preserves exact preview", async ({
  page,
}) => {
  await page.goto("/testing/video-publication-caption");
  const media = page.getByLabel("当前内容的已审核素材");
  const confirm = page.getByRole("checkbox");
  await media.selectOption({ label: "SYNTHETIC 视频 · 无配文" });
  await expect(page.getByText("已批准 MP4 成片；无附加文案。", { exact: false })).toBeVisible();
  await confirm.check();
  await media.selectOption({ label: "SYNTHETIC 视频 · 已审核配文" });
  await expect(confirm).not.toBeChecked();
  await expect(
    page.getByText("SYNTHETIC approved caption; no factory claims.", { exact: false }),
  ).toBeVisible();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.getByRole("button", { name: "确认并提交素材发布" }).click();
  await expect(page.getByText("请确认本次发布。", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await confirm.check();
  await media.selectOption({ label: "SYNTHETIC 视频 · 无配文" });
  await expect(confirm).not.toBeChecked();
  await expect(page.getByText("SYNTHETIC approved caption; no factory claims.")).toHaveCount(0);
  await media.selectOption({ label: "SYNTHETIC 视频 · 已审核配文" });
  await confirm.check();
  await page.getByRole("button", { name: "确认并提交素材发布" }).click();
  await expect(page.getByRole("status")).toContainText("本次请求未提交");
  expect(writes).toHaveLength(1);
});
