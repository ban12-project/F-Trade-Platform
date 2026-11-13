import { expect, test } from "@playwright/test";

for (const stage of ["credentials", "blob"] as const) {
  test(`stopping ${stage} upload retains the file, avoids generation and allows retry`, async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let credentials = 0;
    let blobs = 0;
    let streams = 0;
    let heldSettled = false;
    await page.route("**/api/product-documents/upload", async (route) => {
      credentials++;
      const delayed = stage === "credentials" && credentials === 1;
      if (delayed) await held;
      await route.fulfill({
        json: {
          presignedUrlPayload: {
            delegationToken: `${Buffer.from(JSON.stringify({ storeId: "synthetic" })).toString("base64url")}.synthetic`,
            signature: "synthetic",
            params: {},
          },
        },
      });
      if (delayed) heldSettled = true;
    });
    await page.route("https://vercel.com/api/blob/**", async (route) => {
      blobs++;
      const delayed = stage === "blob" && blobs === 1;
      if (delayed) await held;
      await route.fulfill({
        json: {
          url: "https://synthetic.private.blob.vercel-storage.com/synthetic.csv",
          pathname: "synthetic.csv",
          contentType: "text/csv",
        },
      });
      if (delayed) heldSettled = true;
    });
    await page.route("**/api/product-agent/stream", async (route) => {
      streams++;
      await route.fulfill({
        status: 400,
        headers: { "x-product-intake-error": "source_labels_missing" },
        json: { error: "Synthetic source failure" },
      });
    });
    await page.goto("/testing/project-workflow?record=product");
    const file = page.getByLabel("产品资料", { exact: true });
    await expect(file).toBeEnabled();
    await file.setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Product name,Synthetic"),
    });
    const submit = page.locator('button[form="product-agent-import"]');
    try {
      await submit.click();
      await expect.poll(() => (stage === "credentials" ? credentials : blobs)).toBe(1);
      await expect(submit).toBeDisabled();
      await page.getByRole("button", { name: "停止上传", exact: true }).click();
      await expect(
        page.getByText("已停止上传，未开始生成。文件选择已保留，可重新尝试。", { exact: true }),
      ).toBeVisible();
      await expect(submit).toBeEnabled();
      await expect(file).toBeEnabled();
      await expect(page.getByRole("button", { name: "停止上传", exact: true })).toHaveCount(0);
      expect(streams).toBe(0);
      expect(await file.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
        "synthetic.csv",
      );
    } finally {
      release();
    }
    // Finish the late response before retrying; cancellation must not start a background run.
    await expect.poll(() => heldSettled).toBe(true);
    expect(streams).toBe(0);
    await submit.click();
    await expect.poll(() => streams).toBe(1);
    await expect(submit).toBeEnabled();
    await expect(
      page.getByText("已停止上传，未开始生成。文件选择已保留，可重新尝试。", { exact: true }),
    ).toHaveCount(0);
    expect(credentials).toBe(2);
    expect(blobs).toBe(stage === "blob" ? 2 : 1);
  });
}
