import { expect, test } from "@playwright/test";

test("desktop node selection updates the inspector without a drawer overlay", async ({ page }) => {
  await page.goto("/testing/project-canvas");
  await page.getByRole("button", { name: "产品事实，打开流程面板" }).click();

  const inspector = page.getByRole("complementary");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "产品事实" })).toBeVisible();
  await expect(inspector.getByText("导入、录入、审核和修订都在当前营销项目中完成。")).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "智能导入" })).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="drawer-popup"]')).toHaveCount(0);
});

test("select triggers display the same label as their selected item", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=content");
  await page.waitForLoadState("networkidle");

  const inspector = page.getByRole("complementary");
  const selects = inspector.getByRole("combobox");
  await expect(selects.nth(0)).toContainText("SYN-001 · Verified clutch kit");
  await expect(selects.nth(0)).not.toContainText("00000000-0000-4000-8000-000000000301");
  await expect(selects.nth(1)).toContainText("产品推广");
  await expect(selects.nth(1)).not.toHaveText("product");
});

test("Product Agent keeps saved models selectable for each import", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=product");
  await page.waitForLoadState("networkidle");

  const inspector = page.getByRole("complementary");
  const model = inspector.getByRole("combobox", { name: "模型", exact: true });
  await expect(model).toContainText("日常产品导入 · gpt-5-mini");
  await model.press("Enter");
  await expect(model).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option", { name: "日常产品导入 · gpt-5.6-terra" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(model).toContainText("日常产品导入 · gpt-5.6-terra");
  await model.press("Enter");
  await expect(model).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option", { name: "复杂目录识别 · claude-sonnet-test" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(model).toContainText("复杂目录识别 · claude-sonnet-test");
});

test("marketing content work stays in the canvas panel", async ({ page }) => {
  await page.goto("/testing/project-canvas");
  await page.getByRole("button", { name: "营销内容，打开流程面板" }).click();

  await expect(page).toHaveURL(/panel=content/);
  const inspector = page.getByRole("complementary");
  await expect(inspector.getByRole("heading", { name: "营销内容" })).toBeVisible();
  await expect(inspector.getByText("新建待审内容", { exact: true })).toBeVisible();
  await expect(inspector.getByText("从当前项目的 Product Ready 事实创建、审核和修订营销内容。")).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
});

test("product Gate 01 review stays inside the product panel", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=product&state=product-review");

  const inspector = page.getByRole("complementary");
  await expect(inspector.getByText("产品事实与证据")).toBeVisible();
  await expect(inspector.getByText("Gate 01 决定")).toBeVisible();
  const decision = inspector.getByRole("button", { name: "请先选择决定" });
  await expect(decision).toBeVisible();
  await expect(decision).toBeDisabled();
  await expect(inspector.getByText("请选择审核决定")).toBeVisible();
});

test("rejected content exposes revision in the same content panel", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=content&state=content-revision");

  const inspector = page.getByRole("complementary");
  await expect(inspector.getByText("修订内容草稿")).toBeVisible();
  await expect(inspector.getByRole("button", { name: "提交修订并送审" })).toBeVisible();
  await expect(page.locator(".react-flow__node").filter({ hasText: "审核" })).toHaveCount(0);
});

test("sales canvas exposes the complete human-controlled flow", async ({ page }) => {
  await page.goto("/testing/project-canvas?kind=sales");
  await page.getByRole("button", { name: "客户询盘，打开流程面板" }).click();
  await expect(page.getByRole("complementary").getByText("录入询盘", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "产品引用，打开流程面板" }).click();
  await expect(page).toHaveURL(/panel=product/);
  await expect(page.getByRole("complementary").getByText("添加产品引用", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "人工报价，打开流程面板" }).click();
  await expect(page).toHaveURL(/panel=quotation/);
  await expect(page.getByRole("complementary").getByText("创建人工报价", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /自动报价/ })).toHaveCount(0);
  await expect(page.getByText("跟进与商机", { exact: true })).toBeVisible();
  await expect(page.getByText("交期确认", { exact: true })).toBeVisible();
});

test("follow-up shows the authorized encrypted timeline and explicit human send", async ({ page }) => {
  await page.goto("/testing/project-canvas?kind=sales&panel=lead");
  const inspector = page.getByRole("complementary");
  await expect(inspector.getByText("授权消息时间线", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Synthetic buyer asks for the verified lead time.")).toBeVisible();
  await expect(inspector.getByText("等待发送", { exact: true })).toBeVisible();
  await expect(inspector.getByText("禁止自动承诺价格、交期或样品", { exact: false })).toBeVisible();
  await expect(inspector.getByLabel("本次人工确认凭据")).toBeVisible();
  await expect(inspector.getByRole("button", { name: "人工确认并发送此回复" })).toBeEnabled();
  await expect(inspector.getByLabel("外部发送凭证")).toHaveCount(0);
  await inspector.getByRole("combobox", { name: "当前场景" }).click();
  await page.getByRole("option", { name: "询问交期" }).click();
  await expect(inspector.getByText("将插入已确认交期：21 天")).toBeVisible();
  await expect(inspector.getByText("交期句由服务端插入", { exact: false })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "人工确认并发送此回复" })).toBeEnabled();
});

test("publication confirmation submits a controlled job instead of claiming success", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=publication");
  const inspector = page.getByRole("complementary");
  await expect(inspector.getByText("确认并提交发布", { exact: true })).toBeVisible();
  await expect(inspector.getByText("平台回执前不会显示为已发布", { exact: false })).toBeVisible();
  await expect(inspector.getByLabel("平台发布凭证")).toHaveCount(0);
  await expect(inspector.getByRole("button", { name: "确认并提交此条发布" })).toBeDisabled();
});

test("desktop control panel is viewport-bound and scrolls internally", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/testing/project-canvas?panel=product");

  const inspector = page.getByRole("complementary");
  const box = await inspector.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeLessThanOrEqual(552);
  await expect(inspector.locator('[data-slot="scroll-area-viewport"]')).toHaveCSS("overflow-y", "scroll");
});

test("mobile node selection opens the drawer overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/project-canvas");
  await page.getByRole("button", { name: "产品事实，打开流程面板" }).click();

  await expect(page.locator('[data-slot="drawer-popup"]')).toBeVisible();
  await expect(page.locator('[data-slot="drawer-overlay"]')).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  for (const target of await page.locator(".react-flow__node button, .react-flow__controls-button, nav[aria-label='画布操作坞'] button").all()) {
    const box = await target.boundingBox();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test("keyboard opens and closes a node panel and restores focus", async ({ page }) => {
  await page.goto("/testing/project-canvas");
  const node = page.getByRole("button", { name: "产品事实，打开流程面板" });
  await node.focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByRole("complementary");
  await expect(inspector.getByRole("heading", { name: "产品事实" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(node).toBeFocused();
});

test("arrange mode enables precise keyboard movement and cancel", async ({ page }) => {
  await page.goto("/testing/project-canvas");
  await expect(page.locator(".react-flow")).toHaveClass(/opacity-100/);
  const node = page.getByRole("button", { name: "产品事实，打开流程面板" });
  const before = await node.boundingBox();
  await page.getByRole("button", { name: "整理画布" }).click();
  await node.focus();
  await page.keyboard.press("ArrowRight");
  const moved = await node.boundingBox();
  expect(Math.round(moved!.x - before!.x)).toBe(8);
  await page.keyboard.press("Shift+ArrowLeft");
  const precise = await node.boundingBox();
  expect(Math.round(precise!.x - before!.x)).toBe(7);
  await page.getByRole("button", { name: "取消" }).click();
  const restored = await node.boundingBox();
  expect(Math.round(restored!.x - before!.x)).toBe(0);
});

test("marketing video node opens the viewport-bound editor and reflects URL state", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/testing/project-canvas");
  await page.getByText("营销视频", { exact: true }).click();

  await expect(page).toHaveURL(/panel=video/);
  const inspector = page.getByRole("complementary");
  await expect(inspector.getByText("最长 15 秒")).toBeVisible();
  await expect(inspector.getByText("8.0 / 15 秒")).toBeVisible();
  const box = await inspector.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(672);
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("marketing video editor blocks a draft longer than 15 seconds in the browser", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=video");
  const durations = page.getByLabel("成片时长（秒）");
  await durations.nth(0).fill("10");
  await durations.nth(1).fill("10");

  await expect(page.getByText("视频过长")).toBeVisible();
  await expect(page.getByRole("button", { name: "合成预览" })).toBeDisabled();
});

test("marketing video editor keeps factual caption values server-controlled", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=video");
  await page.getByLabel("字幕类型").first().selectOption("creative");
  await page.getByLabel("创意字幕").fill("OE 99999");
  await page.getByRole("complementary").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("创意文案不能包含工程或商业事实；请改用核验事实字段。")).toBeVisible();

  await page.getByLabel("字幕类型").first().selectOption("verified_fact");
  await expect(page.getByLabel("创意字幕")).toHaveCount(0);
  await expect(page.getByLabel("事实字段")).toContainText("product.product_name · Verified clutch kit");
});

test("switching nodes protects an unsaved video draft", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=video");
  await page.getByLabel("成片时长（秒）").first().fill("6");
  await page.getByText("营销内容", { exact: true }).click();
  const alert = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/panel=video/);
  await page.getByText("营销内容", { exact: true }).click();
  await alert.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page).toHaveURL(/panel=content/);
});

test("marketing video panel exposes upload and post-render review without generation controls", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=video");
  await page.getByRole("complementary").getByRole("button", { name: "新建" }).click();

  await expect(page.getByLabel("素材（1–3 个）")).toHaveAttribute("accept", /video\/mp4/);
  await expect(page.getByLabel("素材权利证据")).toBeVisible();
  await expect(page.getByText("不会调用视频生成模型")).toBeVisible();
  await expect(page.getByRole("button", { name: /生成视频|模型配置|供应商/ })).toHaveCount(0);

  await page.goto("/testing/project-canvas?panel=video&state=review");
  await expect(page.getByText("私有预览")).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("src", /\/api\/video-preview\/asset-rendered-preview-001$/);
  await expect(page.getByRole("button", { name: "退回修改" })).toBeVisible();
  await expect(page.getByRole("button", { name: "通过成片" })).toBeVisible();
});

test("approved marketing video exposes its controlled MP4 download", async ({ page }) => {
  await page.goto("/testing/project-canvas?panel=video&state=approved");
  await expect(page.getByRole("link", { name: "下载 MP4" })).toHaveAttribute("href", "/api/video-download/00000000-0000-4000-8000-000000000401");
  await expect(page.getByRole("button", { name: "通过成片" })).toHaveCount(0);
});
