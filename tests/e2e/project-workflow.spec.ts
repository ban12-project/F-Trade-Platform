import { expect, test } from "@playwright/test";

test("Product Agent keeps saved models selectable in the product step", async ({ page }) => {
  await page.goto("/testing/project-workflow?panel=product");
  await page.waitForLoadState("networkidle");
  const model = page
    .getByRole("complementary")
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
  await expect(detail.getByText("Gate 01 决定", { exact: true })).toBeVisible();
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
  const detail = page.getByRole("complementary");
  await expect(detail.getByText("修订内容草稿")).toBeVisible();
  await expect(detail.getByRole("button", { name: "提交修订并送审" })).toBeVisible();
});

test("sales demand confirmation includes RFQ and product references", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&panel=rfq");
  const detail = page.getByRole("complementary");
  await expect(detail.getByText("录入询盘", { exact: true })).toBeVisible();
  await expect(detail.getByText("添加产品引用", { exact: true })).toBeVisible();
  await expect(detail.getByText("Verified clutch kit")).toBeVisible();
});

test("sales quotation stays explicitly human controlled", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&panel=quotation");
  const detail = page.getByRole("complementary");
  await expect(detail.getByText("创建人工报价", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: /自动报价/ })).toHaveCount(0);
});

test("follow-up shows the authorized timeline and explicit human send", async ({ page }) => {
  await page.goto("/testing/project-workflow?kind=sales&panel=follow-up");
  const detail = page.getByRole("complementary");
  await expect(detail.getByText("授权消息时间线", { exact: true })).toBeVisible();
  await expect(detail.getByText("Synthetic buyer asks for the verified lead time.")).toBeVisible();
  await expect(detail.getByRole("button", { name: "人工确认并发送此回复" })).toBeEnabled();
  await detail.getByRole("combobox", { name: "当前场景" }).click();
  await page.getByRole("option", { name: "询问交期" }).click();
  await expect(detail.getByText("将插入已确认交期：21 天")).toBeVisible();
});

test("publication waits for explicit confirmation and platform receipt", async ({ page }) => {
  await page.goto("/testing/project-workflow?panel=publication");
  const detail = page.getByRole("complementary");
  await expect(detail.getByText("确认并提交发布", { exact: true })).toBeVisible();
  await expect(detail.getByText("平台回执前不会显示为已发布", { exact: false })).toBeVisible();
  await expect(detail.getByRole("button", { name: "确认并提交此条发布" })).toBeDisabled();
});

test("desktop detail region is viewport-bound and scrolls internally", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/testing/project-workflow?panel=product");
  const detail = page.getByRole("complementary");
  await expect(detail.locator('[data-slot="scroll-area-viewport"]')).toHaveCSS(
    "overflow-y",
    "scroll",
  );
});

test("streamed product fields remain review-only and keep a draft link after failure", async ({
  page,
}) => {
  const runId = "00000000-0000-4000-8000-000000000117";
  const productId = "00000000-0000-4000-8000-000000000118";
  const events = [
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
  await page.route("**/api/product-agent/stream", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        events
          .map((event, index) =>
            JSON.stringify({ protocol: "product-agent.v1", runId, sequence: index + 1, ...event }),
          )
          .join("\n") + "\n",
    }),
  );
  await page.goto("/testing/project-workflow?panel=product");
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("产品资料", { exact: true })
    .setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Product name,Synthetic streamed clutch"),
    });
  await page.getByRole("button", { name: "生成待审核草稿", exact: true }).click();
  const progress = page.getByRole("region", { name: "生成字段状态" });
  await expect(progress.getByText("Synthetic streamed clutch", { exact: true })).toBeVisible();
  await expect(progress.getByText("来源校验通过 · 待人工审核", { exact: true })).toBeVisible();
  await expect(progress.getByText("待补证据", { exact: true })).toBeVisible();
  await expect(progress.getByText("校验失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开已保存草稿（新窗口）" })).toHaveAttribute(
    "href",
    `/workspace/00000000-0000-4000-8000-000000000202?panel=product&item=${productId}`,
  );
  await expect(
    page.getByText("生成已停止；已保存的字段仍需人工审核。", { exact: true }),
  ).toBeVisible();
});
