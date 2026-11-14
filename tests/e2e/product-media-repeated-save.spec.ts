import { expect, test } from "@playwright/test";

test("each media registration clears its submitted file and notes, while denial preserves the retry", async ({
  page,
}) => {
  const posts: Record<string, FormDataEntryValue>[] = [];
  let uploads = 0;
  const rightsId = "evidence-synthetic-repeated-media";
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") {
      if (
        request.method() === "PUT" &&
        url.hostname === "vercel.com" &&
        url.pathname.startsWith("/api/blob/")
      ) {
        uploads++;
        return route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          json: {
            url: "https://synthetic.private.blob.vercel-storage.com/synthetic.jpg",
            downloadUrl: "https://synthetic.private.blob.vercel-storage.com/synthetic.jpg",
            pathname: "synthetic.jpg",
            contentType: "image/jpeg",
            contentDisposition: "attachment",
            etag: "synthetic",
          },
        });
      }
      return route.abort();
    }
    if (url.pathname === "/api/video-assets/upload") {
      return route.fulfill({
        json: {
          presignedUrlPayload: {
            delegationToken: `${Buffer.from(JSON.stringify({ storeId: "store_synthetic" })).toString("base64url")}.synthetic`,
            signature: "synthetic",
            params: {},
          },
        },
      });
    }
    if (url.pathname === "/testing/product-media" && request.method() === "POST") {
      const registration = request.postData()?.includes("receiptId");
      if (registration) {
        const data = await new Response(request.postData() ?? "", {
          headers: { "Content-Type": request.headers()["content-type"] },
        }).formData();
        posts.push(
          Object.fromEntries(
            [...data.entries()].map(([key, value]) => [key.replace(/^_?\d+_/, ""), value]),
          ),
        );
      }
      const result = registration
        ? {
            status: posts.length === 3 ? "error" : "success",
            message: `SYNTHETIC media result ${posts.length}`,
            assetId: "00000000-0000-4000-8000-000000000999",
          }
        : { options: [{ id: rightsId, label: "合成授权书.pdf" }], error: "" };
      return route.fulfill({
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(result)}\n`,
      });
    }
    return route.continue();
  });
  await page.goto("/testing/product-media");
  const form = page.locator('form[id^="register-product-media-"]');
  const file = form.getByLabel("图片或视频", { exact: true });
  const description = form.getByLabel("内容说明", { exact: true });
  const tags = form.getByLabel("标签", { exact: true });
  await expect(file).toBeEnabled();
  await form.getByRole("combobox", { name: "素材使用授权证明", exact: true }).click();
  await page.getByRole("option", { name: "合成授权书.pdf", exact: true }).click();
  await form.getByRole("checkbox", { name: "允许剪辑", exact: true }).check();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const draft = Math.min(attempt, 3);
    if (attempt !== 4) {
      await file.setInputFiles({
        name: `synthetic-${draft}.jpg`,
        mimeType: "image/jpeg",
        buffer: Buffer.from("SYNTHETIC ONLY"),
      });
      await description.fill(`SYNTHETIC media ${draft}`);
      await tags.fill(`synthetic-${draft}`);
    }
    await page.getByRole("button", { name: "上传素材并提交审核", exact: true }).click();
    await expect(
      page.getByText(`SYNTHETIC media result ${attempt}`, { exact: true }),
    ).toBeVisible();
    expect(posts).toHaveLength(attempt);
    expect(posts.at(-1)).toMatchObject({
      description: `SYNTHETIC media ${draft}`,
      tags: `synthetic-${draft}`,
      rightsEvidenceRef: rightsId,
      editingAllowed: "true",
    });
    await expect(description).toHaveValue(attempt === 3 ? `SYNTHETIC media ${draft}` : "");
    await expect(tags).toHaveValue(attempt === 3 ? `synthetic-${draft}` : "");
    await expect
      .poll(() => file.evaluate((input: HTMLInputElement) => input.files?.[0]?.name ?? ""))
      .toBe(attempt === 3 ? "synthetic-3.jpg" : "");
    await expect(form.getByRole("checkbox", { name: "允许剪辑", exact: true })).toBeChecked();
  }
  expect(uploads).toBe(4);
});
