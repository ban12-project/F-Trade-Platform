import { expect, test } from "@playwright/test";

for (const revision of [false, true]) {
  test(`${revision ? "revised" : "new"} content explains every invalid text field and preserves manual input`, async ({
    page,
  }) => {
    await page.goto(
      `/testing/project-workflow?record=content${revision ? "&state=content-revision" : ""}`,
    );
    const form = page.locator(revision ? "form#revise-content" : "form#create-content");
    const labels = ["营销目标", "目标客户", "开场句", "正文", "行动号召", "视觉说明"];
    for (const label of labels) await form.getByLabel(label, { exact: true }).fill("");
    await form.getByLabel("标签", { exact: true }).fill("S".repeat(501));
    let writes = 0;
    page.on("request", (r) => {
      if (r.method() === "POST") writes++;
    });
    await page
      .getByRole("button", { name: revision ? "提交修订并送审" : "创建待审内容", exact: true })
      .click();
    await expect(form.getByLabel("营销目标", { exact: true })).toBeFocused();
    for (const label of [...labels, "标签"]) {
      const input = form.getByLabel(label, { exact: true });
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveAccessibleDescription(
        label === "标签" ? "标签不能超过 500 个字符。" : /请填写|不能为空/,
      );
      await input.fill("SYNTHETIC manual input");
      await expect(input).toHaveAttribute("aria-invalid", "false");
      if (label === "视觉说明")
        await expect(input).toHaveAccessibleDescription("不能推断尺寸、材料、结构或零件数量。");
      else await expect(input).not.toHaveAttribute("aria-describedby");
    }
    for (const label of [...labels, "标签"])
      await expect(form.getByLabel(label, { exact: true })).toHaveValue("SYNTHETIC manual input");
    expect(writes).toBe(0);
  });
}

test("AI prerequisite validation focuses and explains the missing audience without submitting", async ({
  page,
}) => {
  await page.goto("/testing/project-workflow?record=content");
  const audience = page.getByLabel("目标客户", { exact: true });
  await audience.fill("");
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") writes++;
  });
  await page.getByRole("button", { name: "生成可编辑初稿", exact: true }).click();
  await expect(audience).toBeFocused();
  await expect(audience).toHaveAttribute("aria-invalid", "true");
  await expect(audience).toHaveAccessibleDescription("请填写目标客户。");
  expect(writes).toBe(0);
});

for (const revision of [false, true]) {
  test(`${revision ? "revised" : "new"} content waits for initialization before accepting the first edit`, async ({
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
    const target = page.getByLabel("目标客户", { exact: true });
    const submit = page.getByRole("button", {
      name: revision ? "提交修订并送审" : "创建待审内容",
      exact: true,
    });
    try {
      await page.goto(
        `/testing/project-workflow?record=content${revision ? "&state=content-revision" : ""}`,
        { waitUntil: "commit" },
      );
      await expect(target).toBeVisible();
      await expect(target).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "生成可编辑初稿", exact: true }),
      ).toBeDisabled();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(target).toBeEnabled();
    await target.fill("SYNTHETIC first audience");
    await page.getByLabel("营销目标", { exact: true }).fill("SYNTHETIC first objective");
    await expect(target).toHaveValue("SYNTHETIC first audience");
    await expect(submit).toBeEnabled();
  });
}
