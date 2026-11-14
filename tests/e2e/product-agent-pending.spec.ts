import { expect, test } from "@playwright/test";

for (const phase of ["upload failure", "stream failure", "stream cancellation"] as const) {
  test(`product import locks its inputs through ${phase} and restores editing`, async ({
    page,
  }) => {
    let release = () => {};
    let heldRequest = false;
    let streamRequests = 0;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/product-documents/upload", async (route) => {
      if (phase === "upload failure") {
        heldRequest = true;
        await held;
        return route.fulfill({ status: 403, json: { error: "SYNTHETIC rejection" } });
      }
      return route.fulfill({
        json: {
          presignedUrlPayload: {
            delegationToken: `${Buffer.from(JSON.stringify({ storeId: "synthetic" })).toString("base64url")}.synthetic`,
            signature: "synthetic",
            params: {},
          },
        },
      });
    });
    await page.route("https://vercel.com/api/blob/**", (route) =>
      route.fulfill({
        json: {
          url: "https://synthetic.private.blob.vercel-storage.com/synthetic.csv",
          pathname: "synthetic.csv",
          contentType: "text/csv",
        },
      }),
    );
    await page.route("**/api/product-agent/stream", async (route) => {
      streamRequests++;
      heldRequest = true;
      await held;
      await route.abort("failed").catch(() => {});
    });
    await page.goto("/testing/project-workflow?record=product");
    await page.waitForLoadState("networkidle");
    const file = page.getByLabel("产品资料", { exact: true });
    await file.setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Product name,SYNTHETIC pending product"),
    });
    await page.getByRole("button", { name: "高级设置：模型", exact: true }).click();
    await page.getByRole("button", { name: "改用已有资料中的文本", exact: true }).click();
    const form = page.locator("#product-agent-import");
    const text = form.getByLabel("已授权资料文本", { exact: true });
    await text.fill("SYNTHETIC retained source text");
    const model = form.getByRole("combobox", { name: "模型", exact: true });
    const submit = page.locator('button[type="submit"][form="product-agent-import"]');
    const stop = page.getByRole("button", { name: "停止生成", exact: true });
    try {
      await submit.click();
      await expect.poll(() => heldRequest).toBe(true);
      await expect(text).toBeDisabled();
      await expect(model).toBeDisabled();
      await expect(form.getByLabel("实物图片（可选）")).toBeDisabled();
      await expect(file).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect(form).toHaveAttribute("aria-busy", "true");
      if (phase === "upload failure") {
        await expect(stop).toHaveCount(0);
        expect(streamRequests).toBe(0);
      } else {
        await expect(stop).toBeEnabled();
        if (phase === "stream cancellation") {
          await stop.click();
          await expect(
            page.getByText("生成已停止，已保存字段仍可在草稿中查看。", { exact: true }),
          ).toBeVisible();
        }
      }
    } finally {
      release();
    }
    await expect(submit).toBeEnabled();
    await expect(form).toHaveAttribute("aria-busy", "false");
    await expect(text).toBeEnabled();
    await expect(text).toHaveValue("SYNTHETIC retained source text");
    await expect(model).toBeEnabled();
    await expect(model).toContainText("日常产品导入 · gpt-5-mini");
    await expect(file).toHaveValue(/synthetic\.csv$/);
    await text.fill("SYNTHETIC corrected source text");
    await expect(text).toHaveValue("SYNTHETIC corrected source text");
  });
}
