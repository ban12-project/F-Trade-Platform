import { expect, test } from "@playwright/test";
import { videoPublicationReconciliationSchema } from "../../lib/social/publication-reconciliation-schema";

test("Reel reconciliation accepts either canonical slash form and rejects noncanonical URLs", () => {
  const input = {
    projectId: "11111111-1111-4111-8111-111111111111",
    publicationId: "22222222-2222-4222-8222-222222222222",
    externalPublicationRef: "https://www.facebook.com/reel/123456789/",
    evidenceRef: "evidence-synthetic-reel",
    confirmed: true,
  };
  for (const suffix of ["", "/"]) {
    expect(
      videoPublicationReconciliationSchema.parse({
        ...input,
        externalPublicationRef: `https://www.facebook.com/reel/123456789${suffix}`,
      }).externalPublicationRef,
    ).toBe(input.externalPublicationRef);
  }
  for (const url of [
    "https://www.facebook.com/reel/123456789?tracking=1",
    "https://www.facebook.com/reel/123456789/#fragment",
    "https://www.facebook.com/reel/123456789//",
    "https://www.facebook.com/reel/not-a-number",
    "https://www.facebook.com.evil.invalid/reel/123456789",
    "https://user@www.facebook.com/reel/123456789",
    "http://www.facebook.com/reel/123456789",
  ]) {
    expect(
      videoPublicationReconciliationSchema.safeParse({ ...input, externalPublicationRef: url })
        .success,
    ).toBe(false);
  }
});

test("unknown publication requires reviewed evidence and rejects an unauthenticated confirmation", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?kind=marketing&record=publication&state=unknown");
  await page.getByText("查看处理详情", { exact: true }).click();
  await expect(page.getByText("发布步骤未取得可验证回执", { exact: true })).toBeVisible();
  await expect(page.getByText("发布点击完成", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "确认已发布结果" }).click();
  await expect(
    page.getByText("请先核对账号、完整文案、受众和帖子链接。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("请选择发布结果核对依据。", { exact: true })).toBeVisible();
  await page.getByLabel("已发布帖子的链接").fill("https://www.facebook.com/synthetic/posts/12345");
  await page.getByLabel("发布结果核对依据").click();
  await page.getByRole("option", { name: "合成审核记录.pdf" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认已发布结果" }).click();
  await expect(page.getByText("需要登录并具有人工审核权限。", { exact: true })).toBeVisible();
  await expect(page.getByText("结果待人工核对", { exact: true })).toBeVisible();
});
