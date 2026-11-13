import { expect, test } from "@playwright/test";

for (const stage of ["credentials", "blob"] as const) {
  test(`catalog ${stage} cancellation isolates late replies and stops at intake dispatch`, async ({
    page,
  }) => {
    const releases: (() => void)[] = [];
    const holds = Array.from(
      { length: 3 },
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    let credentials = 0;
    let blobs = 0;
    let intakes = 0;
    let firstSettled = false;
    await page.route("**/api/product-documents/upload", async (route) => {
      const index = credentials++;
      if (stage === "credentials") await holds[index];
      await route.fulfill({
        json: {
          presignedUrlPayload: {
            delegationToken: `${Buffer.from(JSON.stringify({ storeId: "synthetic" })).toString("base64url")}.synthetic`,
            signature: "synthetic",
            params: {},
          },
        },
      });
      if (stage === "credentials" && index === 0) firstSettled = true;
    });
    await page.route("https://vercel.com/api/blob/**", async (route) => {
      const index = blobs++;
      if (stage === "blob") await holds[index];
      await route.fulfill({
        json: {
          url: "https://synthetic.private.blob.vercel-storage.com/synthetic.csv",
          pathname: "synthetic.csv",
          contentType: "text/csv",
        },
      });
      if (stage === "blob" && index === 0) firstSettled = true;
    });
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const [input] = JSON.parse(route.request().postData() ?? "[]");
      if (typeof input !== "string") {
        expect(input.receiptId).toBeTruthy();
        intakes++;
        await holds[2];
      }
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(
          typeof input === "string"
            ? { status: "success", view: null }
            : { status: "error", message: "Synthetic intake rejected" },
        )}\n`,
      });
    });
    try {
      await page.goto("/testing/project-workflow?record=product");
      await page.getByRole("tab", { name: "产品目录", exact: true }).click();
      const file = page.getByLabel("产品资料", { exact: true });
      await expect(file).toBeEnabled();
      await file.setInputFiles({
        name: "synthetic.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Product name,Synthetic"),
      });
      const submit = page.getByRole("button", { name: "上传并解析目录", exact: true });
      const stop = page.getByRole("button", { name: "停止上传", exact: true });
      await submit.click();
      await expect.poll(() => (stage === "credentials" ? credentials : blobs)).toBe(1);
      await stop.click();
      await expect(
        page.getByText("已停止上传，未创建目录任务。文件选择已保留，可重新尝试。", { exact: true }),
      ).toBeVisible();
      await expect(submit).toBeEnabled();
      await expect(file).toBeEnabled();
      expect(await file.evaluate((el: HTMLInputElement) => el.files?.[0]?.name)).toBe(
        "synthetic.csv",
      );
      expect(intakes).toBe(0);
      // Start a new attempt before the old response returns.
      await submit.click();
      await expect.poll(() => (stage === "credentials" ? credentials : blobs)).toBe(2);
      releases[0]?.();
      await expect.poll(() => firstSettled).toBe(true);
      await expect(stop).toBeVisible();
      await expect(file).toBeDisabled();
      await expect(page.getByRole("button", { name: "提交中…", exact: true })).toBeDisabled();
      expect(intakes).toBe(0);
      releases[1]?.();
      await expect.poll(() => intakes).toBe(1);
      // The server may now create background work: client-only cancellation is no longer offered.
      await expect(stop).toHaveCount(0);
      await expect(file).toBeDisabled();
      await expect(page.getByRole("button", { name: "提交中…", exact: true })).toBeDisabled();
      releases[2]?.();
      await expect(page.getByText("Synthetic intake rejected", { exact: true })).toBeVisible();
      await expect(submit).toBeEnabled();
      expect(intakes).toBe(1);
      expect(credentials).toBe(2);
      expect(blobs).toBe(stage === "blob" ? 2 : 1);
    } finally {
      for (const release of releases) release();
    }
  });
}
