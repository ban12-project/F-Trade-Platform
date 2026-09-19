import { expect, test } from "@playwright/test";

test("Product Agent keeps saved models selectable in the product step", async ({ page }) => {
  await page.goto("/testing/project-workflow?panel=product");
  await page.waitForLoadState("networkidle");
  const model = page
    .getByRole("region", { name: /详情与审批/ })
    .getByRole("combobox", { name: "模型", exact: true });
  await expect(model).toContainText("日常产品导入 · gpt-5-mini");
  await model.click();
  await expect(
    page.getByRole("option", { name: "复杂目录识别 · claude-sonnet-test" }),
  ).toBeVisible();
});

test("product Gate 01 submits the displayed revision and approval request", async ({ page }) => {
  await page.goto("/testing/project-workflow?panel=product&state=product-review");
  await page.waitForLoadState("networkidle");
  const detail = page.getByRole("region", { name: "当前阶段", exact: true });
  await expect(detail.getByText("产品事实与证据")).toBeVisible();
  await expect(detail.getByText("产品核实决定", { exact: true })).toBeVisible();
  await expect(detail.getByText(/审核版本 1/)).toBeVisible();
  await expect(detail.getByRole("button", { name: "请先选择决定" })).toBeDisabled();
  await detail.getByRole("combobox").filter({ hasText: "请选择审核决定" }).press("ArrowDown");
  await page.getByRole("option", { name: "批准产品事实", exact: true }).click();
  await detail.getByRole("combobox", { name: "审核证据" }).press("ArrowDown");
  await page.getByRole("option", { name: /Synthetic review evidence/ }).click();
  // Capture the actual Action body without executing a business write or requiring a login.
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });
  const request = page.waitForRequest(
    (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await detail.getByRole("button", { name: "批准产品事实", exact: true }).click();
  const body = (await request).postData() ?? "";
  expect(body).toMatch(/name="[^"\n]*reviewedVersion"\r?\n\r?\n1/);
  expect(body).toMatch(/name="[^"\n]*approvalId"\r?\n\r?\n00000000-0000-4000-8000-000000000302/);
});

test("rejected content exposes revision in the content step", async ({ page }) => {
  await page.goto("/testing/project-workflow?panel=content&state=content-revision");
  const detail = page.getByRole("region", { name: /详情与审批/ });
  await expect(detail.getByText("修订内容草稿")).toBeVisible();
  await expect(detail.getByRole("button", { name: "提交修订并送审" })).toBeVisible();
});

test("sales demand confirmation includes RFQ and product references", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&panel=rfq");
  const detail = page.getByRole("region", { name: /详情与审批/ });
  await expect(detail.getByText("录入询盘", { exact: true })).toBeVisible();
  await expect(detail.getByText("添加产品引用", { exact: true })).toBeVisible();
  await expect(detail.getByText("Verified clutch kit")).toBeVisible();
});

test("sales quotation stays explicitly human controlled", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&panel=quotation");
  const detail = page.getByRole("region", { name: /详情与审批/ });
  await expect(detail.getByText("创建人工报价", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: /自动报价/ })).toHaveCount(0);
});

test("follow-up shows the authorized timeline and explicit human send", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&panel=follow-up");
  const detail = page.getByRole("region", { name: /详情与审批/ });
  await expect(detail.getByText("授权消息时间线", { exact: true })).toBeVisible();
  await expect(detail.getByText("Synthetic buyer asks for the verified lead time.")).toBeVisible();
  await expect(detail.getByRole("button", { name: "人工确认并发送此回复" })).toBeEnabled();
  await detail.getByRole("combobox", { name: "当前场景" }).click();
  await page.getByRole("option", { name: "询问交期" }).click();
  await expect(detail.getByText("将插入已确认交期：21 天")).toBeVisible();
});

test("publication waits for explicit confirmation and platform receipt", async ({ page }) => {
  await page.goto("/testing/project-workflow?panel=publication");
  const detail = page.getByRole("region", { name: /详情与审批/ });
  await expect(detail.getByText("尚无可发布内容", { exact: true })).toBeVisible();
  await expect(detail.getByText("平台回执前不会显示为已发布", { exact: false })).toBeVisible();
  await expect(detail.locator("#publication-confirmation")).toHaveCount(0);
});

test("editor uses the main document width and appears before related tasks", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/testing/project-workflow?panel=product");
  const detail = page.getByRole("region", { name: /详情与审批/ });
  expect((await detail.boundingBox())?.width).toBeGreaterThan(800);
  await expect(detail.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(0);
  const tasks = page.getByRole("complementary", { name: "相关任务" });
  expect((await detail.boundingBox())!.y).toBeLessThan((await tasks.boundingBox())!.y);
});

for (const zeroAccepted of [false, true]) {
  test(`streamed product fields keep actionable feedback after ${zeroAccepted ? "zero accepted fields" : "partial failure"}`, async ({
    page,
  }) => {
    const runId = "00000000-0000-4000-8000-000000000117";
    const productId = "00000000-0000-4000-8000-000000000118";
    const sourceBytes = Buffer.from("Product name,Synthetic streamed clutch");
    let receiptId = "";
    let uploaded = false;
    // This test exercises the browser transport and stream display with synthetic services.
    // Real signing, authorization and private readback have separate integration coverage.
    await page.route("**/api/product-documents/upload", async (route) => {
      const request = route.request().postDataJSON();
      const payload = JSON.parse(request.payload.clientPayload);
      expect(payload).toMatchObject({
        projectId: "00000000-0000-4000-8000-000000000202",
        purpose: "agent",
        originalFilename: "synthetic.csv",
        contentType: "text/csv",
        sizeBytes: sourceBytes.length,
      });
      receiptId = payload.receiptId;
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
      expect(route.request().method()).toBe("PUT");
      expect(route.request().postDataBuffer()).toEqual(sourceBytes);
      uploaded = true;
      await route.fulfill({
        json: {
          url: "https://synthetic.private.blob.vercel-storage.com/synthetic.csv",
          pathname: "synthetic.csv",
          contentType: "text/csv",
        },
      });
    });
    const events = zeroAccepted
      ? [
          { type: "stage", stage: "generating" },
          { type: "draft", productId, version: 1 },
          {
            type: "error",
            code: "no_accepted_fields",
            message:
              "未提取到可由来源验证的字段，本次导入未成功。CSV 可使用 Product name、OE、Application。",
          },
          { type: "stage", stage: "failed" },
        ]
      : [
          { type: "stage", stage: "generating" },
          { type: "draft", productId, version: 2 },
          {
            type: "field",
            field: "product.product_name",
            value: "Synthetic streamed clutch",
            evidenceRef: "evidence-synthetic",
            status: "source_validated",
          },
          {
            type: "field",
            field: "product.oe_numbers",
            value: null,
            evidenceRef: null,
            status: "needs_evidence",
          },
          {
            type: "field",
            field: "specifications.spline_count",
            value: 0,
            evidenceRef: "evidence-synthetic",
            status: "invalid",
          },
          { type: "error", code: "run_failed", message: "生成已停止；已保存的字段仍需人工审核。" },
          { type: "stage", stage: "failed" },
        ];
    await page.route("**/api/product-agent/stream", (route) => {
      expect(uploaded).toBe(true);
      expect(receiptId).not.toBe("");
      const body = route.request().postData() ?? "";
      expect(body).toContain(receiptId);
      expect(body).not.toContain("filename=");
      expect(body).not.toContain(sourceBytes.toString());
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          events
            .map((event, index) =>
              JSON.stringify({
                protocol: "product-agent.v1",
                runId,
                sequence: index + 1,
                ...event,
              }),
            )
            .join("\n") + "\n",
      });
    });
    await page.goto("/testing/project-workflow?panel=product");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("产品资料", { exact: true }).setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: sourceBytes,
    });
    await page.getByRole("button", { name: "生成待审核草稿", exact: true }).click();
    const progress = page.getByRole("region", { name: "生成字段状态" });
    if (!zeroAccepted) {
      await expect(progress.getByText("Synthetic streamed clutch", { exact: true })).toBeVisible();
      await expect(progress.getByText("来源校验通过 · 待人工审核", { exact: true })).toBeVisible();
      await expect(progress.getByText("待补证据", { exact: true })).toBeVisible();
      await expect(progress.getByText("校验失败", { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "打开已保存草稿（新窗口）" })).toHaveAttribute(
      "href",
      `/workspace/00000000-0000-4000-8000-000000000202/records/product/${productId}`,
    );
    await expect(
      page.getByText(
        zeroAccepted
          ? "未提取到可由来源验证的字段，本次导入未成功。CSV 可使用 Product name、OE、Application。"
          : "生成已停止；已保存的字段仍需人工审核。",
        { exact: true },
      ),
    ).toBeVisible();
  });
}

test("product stream rejects cross-origin and unauthenticated requests", async ({
  request,
  baseURL,
}) => {
  const deniedOrigin = await request.post("/api/product-agent/stream", {
    headers: { origin: "https://untrusted.invalid" },
    data: "synthetic",
  });
  expect(deniedOrigin.status()).toBe(403);
  expect(await deniedOrigin.json()).toEqual({ error: "请求来源无效。" });
  const unauthenticated = await request.post("/api/product-agent/stream", {
    headers: { origin: new URL(baseURL ?? "http://localhost:3000").origin },
    data: "synthetic",
  });
  expect(unauthenticated.status()).toBe(403);
  expect(await unauthenticated.json()).toEqual({ error: "仅管理员可运行流式产品导入。" });
});
