import { expect, test } from "@playwright/test";

for (const outcome of ["existing", "absent"] as const) {
  test(`lost catalog intake response requires successful read recovery: ${outcome}`, async ({
    page,
  }) => {
    let uploads = 0;
    let reads = 0;
    let intakes = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const projectId = "00000000-0000-4000-8000-000000000202";
    const view =
      outcome === "existing"
        ? {
            id: "00000000-0000-4000-8000-000000000901",
            status: "ready",
            failureCode: null,
            candidates: [],
          }
        : null;
    await page.route("**/api/product-documents/upload", async (route) => {
      uploads++;
      await route.fulfill({
        json: {
          presignedUrlPayload: {
            delegationToken: `${Buffer.from(JSON.stringify({ storeId: "synthetic" })).toString("base64url")}.synthetic`,
            signature: "synthetic",
            params: {},
          },
        },
      });
    });
    await page.route("https://vercel.com/api/blob/**", async (route) => {
      await route.fulfill({
        json: {
          url: "https://synthetic.private.blob.vercel-storage.com/synthetic.csv",
          pathname: "synthetic.csv",
          contentType: "text/csv",
        },
      });
    });
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const [input] = JSON.parse(route.request().postData() ?? "[]");
      if (typeof input !== "string") {
        expect(input).toMatchObject({ projectId, receiptId: expect.any(String) });
        intakes++;
        return route.abort("failed");
      }
      expect(input).toBe(projectId);
      reads++;
      if (reads === 3) await held;
      const result =
        reads === 2
          ? { status: "error", message: "Synthetic recovery unavailable" }
          : { status: "success", view: reads === 1 ? null : view };
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(result)}\n`,
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
      const upload = page.getByRole("button", { name: "上传并解析目录", exact: true });
      await upload.click();
      await expect.poll(() => intakes).toBe(1);
      await expect(
        page.getByText("无法确认目录任务是否已提交。请先读取已有任务，再决定是否重新上传。", {
          exact: true,
        }),
      ).toBeVisible();
      const retry = page.getByRole("button", { name: "重试读取已有任务", exact: true });
      await expect(upload).toBeDisabled();
      await expect(retry).toBeEnabled();
      await expect(page.getByRole("button", { name: "停止上传", exact: true })).toHaveCount(0);
      await retry.click();
      await expect(page.getByText("Synthetic recovery unavailable", { exact: true })).toBeVisible();
      await expect(upload).toBeDisabled();
      await retry.click();
      await expect.poll(() => reads).toBe(3);
      await expect(retry).toBeDisabled();
      await expect(upload).toBeDisabled();
      expect(uploads).toBe(1);
      expect(intakes).toBe(1);
      release();
      await expect(retry).toHaveCount(0);
      await expect(upload).toBeEnabled();
      await expect(
        outcome === "existing" ? page.locator("#catalog-progress") : upload,
      ).toBeFocused();
      await expect(page.getByText("Synthetic recovery unavailable", { exact: true })).toHaveCount(
        0,
      );
      expect(await file.evaluate((el: HTMLInputElement) => el.files?.[0]?.name)).toBe(
        "synthetic.csv",
      );
      expect(uploads).toBe(1);
      expect(intakes).toBe(1);
    } finally {
      release();
    }
  });
}
