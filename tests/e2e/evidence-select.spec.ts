import { expect, test } from "@playwright/test";

test("evidence selection uses readable names, validates, submits IDs and resets", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/testing/evidence-select");
  await page.waitForLoadState("networkidle");
  const field = page.getByRole("combobox", { name: "素材使用授权证明" });
  await page.getByRole("button", { name: "保存选择", exact: true }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.click();
  await page.getByRole("option", { name: /合成工厂授权书.pdf · 2026-10-02/ }).click();
  await expect(field).toContainText("合成工厂授权书.pdf");
  await expect(field).not.toContainText("evidence-");
  await page.getByRole("button", { name: "保存选择", exact: true }).click();
  await expect(page.getByLabel("提交结果")).toHaveText("evidence-synthetic-rights-761");
  await page.getByRole("button", { name: "清空选择", exact: true }).click();
  await expect(field).toContainText("请选择已保存的资料");
  await expect(page.getByText("暂无可用资料，请上传文件后选择。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上传资料", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "添加来源资料" })).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("资料文件")).toBeVisible();
  expect(errors).toEqual([]);
});

test("an unauthenticated evidence request has an actionable error and no options", async ({
  page,
}) => {
  await page.goto("/testing/product-media");
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox", { name: "素材使用授权证明" }).click();
  await expect(page.getByRole("option", { name: "暂时无法加载资料" })).toBeDisabled();
  await expect(page.getByText("请重新登录并确认项目权限。", { exact: true })).toBeVisible();
});

test("upload explains invalid files, retains failed files and allows retry", async ({ page }) => {
  await page.goto("/testing/evidence-select");
  await page.getByRole("button", { name: "上传资料", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "添加来源资料" });
  const file = dialog.getByLabel("资料文件", { exact: true });
  const save = dialog.getByRole("button", { name: "保存到项目资料库", exact: true });
  let uploads = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/product-documents/upload", async (route) => {
    uploads += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ status: 403, json: { error: "SYNTHETIC upload denied" } });
  });
  await file.setInputFiles({
    name: "synthetic-empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  await save.click();
  await expect(file).toHaveAccessibleDescription(/支持 PDF.*文件为空，请选择包含资料内容的文件。/);
  await expect(file).toBeFocused();
  await file.setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("SYNTHETIC"),
  });
  await save.click();
  await expect(file).toHaveAccessibleDescription(/只支持 PDF、CSV、XLS 和 XLSX 文件。/);
  expect(uploads).toBe(0);
  await file.setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("SYNTHETIC,value\nexample,1"),
  });
  await expect(file).toHaveAttribute("aria-invalid", "false");
  await expect(file).toHaveAccessibleDescription(
    "支持 PDF、CSV、XLS、XLSX，最大 25 MiB；文件保存在私有存储。",
  );
  for (let attempt = 1; attempt <= 2; attempt++) {
    await save.click();
    await expect.poll(() => uploads).toBe(attempt);
    await expect(dialog.getByRole("button", { name: /正在上传并保存资料…/ })).toBeDisabled();
    await expect(file).toBeDisabled();
    await expect(
      dialog.getByText("文件上传失败，请检查文件与项目权限后重试。", { exact: true }),
    ).toHaveCount(0);
    release?.();
    await expect(
      dialog.getByText("文件上传失败，请检查文件与项目权限后重试。", { exact: true }),
    ).toBeVisible();
    await expect(save).toBeEnabled();
    expect(await file.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
      "synthetic.csv",
    );
  }
  await file.setInputFiles({
    name: "synthetic-replacement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("SYNTHETIC,value\nreplacement,2"),
  });
  await expect(
    dialog.getByText("文件上传失败，请检查文件与项目权限后重试。", { exact: true }),
  ).toHaveCount(0);
  expect(uploads).toBe(2);
});

for (const failure of ["denied", "transport"] as const) {
  test(`selected evidence survives ${failure} refresh and retry without being replaced`, async ({
    page,
  }) => {
    await page.goto("/testing/evidence-select");
    const field = page.getByRole("combobox", { name: "素材使用授权证明", exact: true });
    await field.click();
    await page.getByRole("option", { name: /合成工厂授权书.pdf · 2026-10-02/ }).click();
    let requests = 0;
    await page.route("**/testing/evidence-select", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requests++;
      if (requests === 1 && failure === "transport") return route.abort("failed");
      const result =
        requests === 1
          ? { options: [], error: "请重新登录并确认项目权限。" }
          : {
              options:
                requests === 2
                  ? [
                      { id: "evidence-synthetic-other", label: "另一份合成资料.pdf" },
                      { id: "evidence-synthetic-rights-761", label: "合成工厂授权书.pdf" },
                    ]
                  : [],
              error: "",
            };
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(result)}\n`,
      });
    });
    const refresh = page.getByRole("button", { name: "刷新资料列表", exact: true }).first();
    await refresh.click();
    await expect(field).toHaveAccessibleDescription(
      failure === "denied" ? /请重新登录并确认项目权限/ : /资料加载失败，请重试/,
    );
    await expect(field).toContainText("已保留选择，暂时无法核对");
    await expect(field).toHaveAccessibleDescription(/已保留原选择，请恢复资料列表后核对。/);
    await field.click();
    await expect(page.getByRole("option", { name: "暂时无法加载资料" })).toBeDisabled();
    await expect(page.getByRole("option", { name: /合成工厂授权书/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await refresh.click();
    await expect(field).toContainText("合成工厂授权书.pdf");
    await expect(field).toHaveAccessibleDescription(
      "已选择：合成工厂授权书.pdf。请核对是否与本次操作对应。",
    );
    await expect(page.getByLabel("提交结果")).toBeEmpty();
    await page.getByRole("button", { name: "保存选择", exact: true }).click();
    await expect(page.getByLabel("提交结果")).toHaveText("evidence-synthetic-rights-761");
    expect(requests).toBe(2);
    await refresh.click();
    await expect(field).toContainText("请选择已保存的资料");
    await expect(field).toHaveAccessibleDescription("暂无可用资料，请上传文件后选择。");
    await page.getByRole("button", { name: "保存选择", exact: true }).click();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(requests).toBe(3);
  });
}

test("long duplicate evidence labels remain readable and verifiable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/testing/evidence-select");
  const field = page.getByRole("combobox", { name: "素材使用授权证明", exact: true });
  await field.click();
  const selected = page.getByRole("option", { name: /synthetic-catalogue.*2026-10-04/ });
  await expect(selected).toBeVisible();
  expect(await selected.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await selected.click();
  await expect(field).toHaveAccessibleDescription(/已选择：synthetic-catalogue.*2026-10-04/);
  const description = page.locator(`[id="${await field.getAttribute("aria-describedby")}"]`);
  await expect(description).toBeVisible();
  expect(await description.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "保存选择", exact: true }).click();
  await expect(page.getByLabel("提交结果")).toHaveText("evidence-synthetic-long-1");
});

test("late evidence options remain pointer selectable on first open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/testing/evidence-async", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await ready;
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ options: [{ id: "evidence-synthetic-late", label: "MOCK evidence — synthetic test only" }], error: "" })}\n`,
    });
  });
  await page.goto("/testing/evidence-async");
  const field = page.getByRole("combobox", { name: "审核依据", exact: true });
  try {
    await field.click();
    await expect(page.getByRole("option", { name: "正在加载资料…" })).toBeVisible();
  } finally {
    release();
  }
  await page
    .getByRole("option", { name: "MOCK evidence — synthetic test only", exact: true })
    .click();
  await expect(field).toContainText("MOCK evidence — synthetic test only");
  await expect(field).toHaveAccessibleDescription(/已选择：MOCK evidence/);
});
