import { expect, test } from "@playwright/test";

test("manual product intake exposes evidence-bound specification and commercial facts", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto("/testing/product-field-evidence");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "手动录入" }).click();

  const form = page.locator('form[id$="-create-product"]:visible');
  const nameId = await form
    .getByRole("textbox", { name: "产品名称", exact: true })
    .getAttribute("id");
  expect(nameId).toBeTruthy();
  await expect(page.locator(`label[for="${nameId}"]`)).toHaveCount(1);
  await expect(form.getByText("每项产品信息都要选择来源资料", { exact: false })).toBeVisible();
  await expect(form.locator('[data-slot="select-trigger"][id$="-evidence"]')).toHaveCount(20);

  for (const label of ["产品名称来源", "产品类型来源", "内部编号来源"] as const) {
    await expect(form.getByLabel(label, { exact: true })).toHaveAttribute("aria-required", "true");
  }
  for (const label of [
    "OE / OEM 编号来源",
    "适配说明来源",
    "车辆品牌来源",
    "车型来源",
    "盘径来源",
    "花键数来源",
    "花键尺寸来源",
    "摩擦材料来源",
    "套件组成来源",
    "毛重来源",
    "净重来源",
    "包装尺寸来源",
    "最小起订量来源",
    "预计交期来源",
    "包装方式来源",
    "支持定制来源",
    "样品可用性来源",
  ] as const) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  }

  await expect(form.getByText("套件与包装规格", { exact: true })).toBeVisible();
  await expect(form.getByText("商业信息", { exact: true })).toBeVisible();
  await expect(form.getByLabel("套件组成来源", { exact: true })).toBeDisabled();
  await expect(form.getByRole("button", { name: "可提供样品" })).toBeVisible();
  await expect(form.getByRole("button", { name: "暂不提供样品" })).toBeVisible();
  await expect(form.locator("#evidence-ref")).toHaveCount(0);
  await expect(
    form.getByText("同一份资料支持多项信息时，可以重复选择", { exact: false }),
  ).toBeVisible();
  await expect(form.getByText("不能仅凭经验或图片填写", { exact: false })).toBeVisible();
  const images = form.getByLabel("产品图片（可选）", { exact: true });
  await expect(images).toHaveAttribute("multiple", "");
  await expect(images).toHaveAttribute("accept", ".png,.jpg,.jpeg");
  await expect(form.getByText("图片随草稿私有保存", { exact: false })).toBeVisible();
  await expect(form.getByRole("progressbar", { name: "产品信息与来源填写进度" })).toBeVisible();
  await expect(form.getByText("为多项信息选择同一份资料", { exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "应用到 0 个目标字段" })).toBeDisabled();
  await form.getByLabel("产品名称来源", { exact: true }).click();
  await expect(page.getByRole("option", { name: /合成产品目录/ })).toBeVisible();
  await page.getByRole("option", { name: /合成产品目录/ }).click();
  await expect(form.getByLabel("产品名称来源", { exact: true })).toContainText("合成产品目录.pdf");
  expect(runtimeErrors).toEqual([]);
});

test("product error summary focuses the first invalid fact", async ({ page }) => {
  await page.goto("/testing/product-field-evidence");
  await page.getByRole("tab", { name: "手动录入" }).click();
  await page.getByRole("button", { name: "创建待审核草稿" }).click();
  await expect(page.getByRole("alert").getByText(/还有 \d+ 项需要处理/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "产品名称", exact: true })).toBeFocused();
});

test("manual product entry rejects excess images before uploading or saving", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") mutations.push(request.url());
  });
  await page.goto("/testing/product-field-evidence?method=manual");
  const form = page.locator('form[id$="-create-product"]:visible');
  await form
    .getByRole("textbox", { name: "产品名称", exact: true })
    .fill("SYNTHETIC image limit disc");
  await form.getByRole("textbox", { name: "内部编号", exact: true }).fill("SYNTHETIC-IMAGE-LIMIT");
  await form.getByLabel("主要来源资料", { exact: true }).click();
  await page.getByRole("option", { name: /合成产品目录/ }).click();
  for (const label of ["产品名称来源", "产品类型来源", "内部编号来源"]) {
    await form.getByLabel(label, { exact: true }).click();
    await page.getByRole("option", { name: /合成产品目录/ }).click();
  }
  await form.getByLabel("产品图片（可选）", { exact: true }).setInputFiles(
    Array.from({ length: 5 }, (_, i) => ({
      name: `synthetic-${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from("SYNTHETIC image-limit fixture; never uploaded"),
    })),
  );
  await form.getByRole("button", { name: "创建待审核草稿", exact: true }).click();
  await expect(form.getByText("最多上传 4 张产品图片。", { exact: true })).toBeVisible();
  expect(mutations).toEqual([]);
});

test("product evidence feedback follows edits and product type without a batch interaction", async ({
  page,
}) => {
  await page.goto("/testing/product-field-evidence");
  await page.getByRole("tab", { name: "手动录入" }).click();
  const form = page.locator('form[id$="-create-product"]:visible');
  const meter = form.getByRole("progressbar", { name: "产品信息与来源填写进度" });
  const chooseEvidence = async (label: string) => {
    await form.getByLabel(label, { exact: true }).click();
    await page.getByRole("option", { name: /合成产品目录/ }).click();
  };

  await form
    .getByRole("textbox", { name: "产品名称", exact: true })
    .fill("MOCK subscription test disc");
  await form.getByRole("textbox", { name: "内部编号", exact: true }).fill("MOCK-SUBSCRIPTIONS-001");
  await expect(form.getByRole("checkbox", { name: "产品名称", exact: true })).toBeVisible();
  await expect(form.getByRole("checkbox", { name: "内部编号", exact: true })).toBeVisible();
  for (const label of ["产品名称来源", "产品类型来源", "内部编号来源"]) {
    await chooseEvidence(label);
  }
  await expect(meter).toHaveAttribute("aria-valuenow", "16");

  await form.getByRole("textbox", { name: "产品名称", exact: true }).fill("");
  await expect(form.getByRole("checkbox", { name: "产品名称", exact: true })).toHaveCount(0);
  await expect(meter).toHaveAttribute("aria-valuenow", "11");

  await form.getByRole("combobox", { name: "产品类型", exact: true }).click();
  await page.getByRole("option", { name: "离合器套件", exact: true }).click();
  await expect(form.getByLabel("套件组成来源", { exact: true })).toBeEnabled();
  await expect(meter).toHaveAttribute("aria-valuenow", "10");
  await form.getByRole("button", { name: "离合器片", exact: true }).click();
  await chooseEvidence("套件组成来源");
  await expect(meter).toHaveAttribute("aria-valuenow", "15");

  await form.getByRole("combobox", { name: "产品类型", exact: true }).click();
  await page.getByRole("option", { name: "离合器片", exact: true }).click();
  await expect(form.getByLabel("套件组成来源", { exact: true })).toBeDisabled();
  await expect(form.getByLabel("套件组成来源", { exact: true })).toContainText("选择已上传资料");
  await expect(meter).toHaveAttribute("aria-valuenow", "11");
  await expect(form.getByRole("button", { name: "创建待审核草稿", exact: true })).toBeVisible();
});
