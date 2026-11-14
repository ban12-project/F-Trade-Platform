import { expect, test } from "@playwright/test";

test("approval refresh starts a fresh revocation, denial keeps its draft and retry removes review", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const setStatus = async (value: string) =>
    context.addCookies([{ name: "synthetic-media-review", value, url: baseURL }]);
  await setStatus("pending");
  const posts: Record<string, FormDataEntryValue>[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname !== "/testing/product-media" || request.method() !== "POST")
      return route.continue();
    const data = request.headers()["content-type"]?.includes("multipart/form-data")
      ? await new Response(request.postData() ?? "", {
          headers: { "Content-Type": request.headers()["content-type"] },
        }).formData()
      : new FormData();
    const fields = Object.fromEntries(
      [...data.entries()].map(([key, value]) => [key.replace(/^_?\d+_/, ""), value]),
    );
    let result: object = {
      options: [{ id: "evidence-synthetic-review", label: "合成审核依据.pdf" }],
      error: "",
    };
    if (fields.assetId) {
      posts.push(fields);
      if (posts.length === 1) await setStatus("approved");
      if (posts.length === 3) await setStatus("rejected");
      result = {
        status: posts.length === 2 ? "error" : "success",
        message: "SYNTHETIC review response",
        assetId: fields.assetId,
      };
    }
    return route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(result)}\n`,
    });
  });
  await page.goto("/testing/product-media");
  const card = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Authorized front-facing synthetic product image." });
  await card.getByRole("combobox", { name: "审核决定", exact: true }).click();
  await page.getByRole("option", { name: "批准素材", exact: true }).click();
  const selectEvidence = async () => {
    await card.getByRole("combobox", { name: "审核依据", exact: true }).click();
    await page.getByRole("option", { name: "合成审核依据.pdf", exact: true }).click();
  };
  await selectEvidence();
  await card.getByLabel("审核备注", { exact: true }).fill("SYNTHETIC approval");
  await card.getByRole("button", { name: "批准产品素材", exact: true }).click();
  await expect(card.getByRole("button", { name: "撤销素材授权", exact: true })).toBeVisible();
  expect(posts[0]).toMatchObject({ decision: "approved", notes: "SYNTHETIC approval" });
  await expect(card.getByLabel("审核备注", { exact: true })).toHaveValue("");
  await selectEvidence();
  await card.getByRole("button", { name: "撤销素材授权", exact: true }).click();
  await expect(card.getByText("拒绝或撤销产品媒体时必须填写原因。", { exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  await card.getByLabel("审核备注", { exact: true }).fill("SYNTHETIC revocation");
  await card.getByRole("button", { name: "撤销素材授权", exact: true }).click();
  await expect(card.getByText("SYNTHETIC review response", { exact: true })).toBeVisible();
  expect(posts[1]).toMatchObject({
    decision: "rejected",
    notes: "SYNTHETIC revocation",
    evidenceRef: "evidence-synthetic-review",
  });
  await expect(card.getByLabel("审核备注", { exact: true })).toHaveValue("SYNTHETIC revocation");
  await card.getByRole("button", { name: "撤销素材授权", exact: true }).click();
  await expect(card.locator("form")).toHaveCount(0);
  expect(posts).toHaveLength(3);
  expect(posts[2]).toMatchObject({ decision: "rejected", notes: "SYNTHETIC revocation" });
});
