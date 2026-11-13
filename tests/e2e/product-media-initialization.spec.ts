import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

test("media registration waits for initialization before accepting its first edits", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await held;
    await route.continue();
  });
  const form = page.locator('form[id^="register-product-media-"]');
  const description = form.getByLabel("内容说明", { exact: true });
  const expiry = form.getByLabel("授权到期时间", { exact: true });
  const file = form.getByLabel("图片或视频", { exact: true });
  try {
    await page.goto("/testing/product-media", { waitUntil: "commit" });
    await expect(description).toBeVisible();
    await expect(description).toBeDisabled();
    await expect(expiry).toBeDisabled();
    await expect(file).toBeDisabled();
    await expect(form.getByRole("combobox", { name: "素材来源", exact: true })).toBeDisabled();
    await expect(form.getByRole("checkbox", { name: "允许剪辑", exact: true })).toBeDisabled();
    await expect(form).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(description).toBeEnabled();
  await description.fill("SYNTHETIC first edit retained");
  await expiry.fill("2027-11-07T01:30");
  await form
    .getByLabel("授权到期重复时间选择", { exact: true })
    .selectOption("2027-11-07T06:30:00.000Z");
  await form.getByRole("checkbox", { name: "允许剪辑", exact: true }).check();
  await expect(description).toHaveValue("SYNTHETIC first edit retained");
  await expect(expiry).toHaveValue("2027-11-07T01:30");
  await expect(form).toHaveAttribute("aria-busy", "false");
});

test("media upload locks its submitted fields and restores the same draft after denial", async ({
  page,
}) => {
  await page.route("**/testing/product-media", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ options: [{ id: "evidence-synthetic-rights-997", label: "合成授权书.pdf" }], error: "" })}\n`,
    });
  });
  let uploads = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/video-assets/upload", async (route) => {
    uploads++;
    await held;
    await route.fulfill({ status: 403, json: { error: "SYNTHETIC upload denied" } });
  });
  await page.goto("/testing/product-media");
  const form = page.locator('form[id^="register-product-media-"]');
  const file = form.getByLabel("图片或视频", { exact: true });
  const description = form.getByLabel("内容说明", { exact: true });
  const expiry = form.getByLabel("授权到期时间", { exact: true });
  const rights = form.getByRole("combobox", { name: "素材使用授权证明", exact: true });
  const editing = form.getByRole("checkbox", { name: "允许剪辑", exact: true });
  await expect(file).toBeEnabled();
  await file.setInputFiles({
    name: "synthetic.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("SYNTHETIC only"),
  });
  await description.fill("SYNTHETIC upload draft");
  await expiry.fill("2027-11-07T01:30");
  const occurrence = form.getByLabel("授权到期重复时间选择", { exact: true });
  await occurrence.selectOption("2027-11-07T06:30:00.000Z");
  await editing.check();
  await rights.click();
  await page.getByRole("option", { name: "合成授权书.pdf", exact: true }).click();
  const save = page.getByRole("button", { name: "上传素材并提交审核", exact: true });
  try {
    await save.click();
    await expect.poll(() => uploads).toBe(1);
    await expect(form).toHaveAttribute("aria-busy", "true");
    for (const control of [
      file,
      description,
      expiry,
      occurrence,
      rights,
      editing,
      form.getByRole("combobox", { name: "素材来源", exact: true }),
      form.getByRole("button", { name: "上传资料", exact: true }),
      form.getByRole("button", { name: "刷新资料列表", exact: true }),
    ])
      await expect(control).toBeDisabled();
    await expect(page.getByRole("button", { name: "上传中…", exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(save).toBeEnabled();
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(description).toHaveValue("SYNTHETIC upload draft");
  await expect(expiry).toHaveValue("2027-11-07T01:30");
  await expect(occurrence).toHaveValue("2027-11-07T06:30:00.000Z");
  await expect(editing).toBeChecked();
  expect(await file.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
    "synthetic.jpg",
  );
  expect(uploads).toBe(1);
});
