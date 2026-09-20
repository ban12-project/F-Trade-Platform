import { expect, test } from "@playwright/test";

test("unknown publication requires reviewed evidence and rejects an unauthenticated confirmation", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?kind=marketing&panel=publication&state=unknown");
  await page.getByRole("button", { name: "确认已发布结果" }).click();
  await expect(
    page.getByText("请先核对账号、完整文案、受众和帖子链接。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("请填写 evidence- 开头的私有核对依据编号。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("已发布帖子的链接").fill("https://www.facebook.com/synthetic/posts/12345");
  await page.getByLabel("私有核对依据编号").fill("evidence-synthetic-review");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认已发布结果" }).click();
  await expect(page.getByText("需要登录并具有人工审核权限。", { exact: true })).toBeVisible();
  await expect(page.getByText("结果待人工核对", { exact: true })).toBeVisible();
});
