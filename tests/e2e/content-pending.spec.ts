import { expect, test } from "@playwright/test";

for (const operation of ["new", "revise", "generate"] as const) {
  test(`content ${operation} preserves the draft while its request is pending`, async ({
    page,
  }) => {
    await page.goto(
      `/testing/project-workflow?record=content${operation === "revise" ? "&state=content-revision" : ""}`,
    );
    const form = page.locator(
      operation === "revise" ? "form#revise-content" : "form#create-content",
    );
    for (const label of ["开场句", "正文", "行动号召", "视觉说明"])
      await form.getByLabel(label, { exact: true }).fill("SYNTHETIC submitted content");
    const body = form.getByLabel("正文", { exact: true });
    let release = () => {};
    let requested = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() === "POST") {
        requested = true;
        await held;
      }
      await route.continue();
    });
    const submit =
      operation === "generate"
        ? form.getByRole("button", { name: /生成可编辑初稿/ })
        : page.locator(
            `button[type="submit"][form="${operation === "revise" ? "revise-content" : "create-content"}"]`,
          );
    try {
      await submit.click();
      await expect.poll(() => requested).toBe(true);
      await expect(submit).toBeDisabled();
      if (operation === "generate") {
        await expect(body).toBeEnabled();
        await body.fill("SYNTHETIC newer manual content");
      } else {
        await expect(body).toBeDisabled();
        await expect(form.getByLabel("目标客户", { exact: true })).toBeDisabled();
        await expect(form.getByRole("combobox", { name: "内容类型", exact: true })).toBeDisabled();
        await expect(form).toHaveAttribute("aria-busy", "true");
      }
    } finally {
      release();
    }
    // No session is signed in: the actual Action rejects without any business write.
    await expect(submit).toBeEnabled();
    await expect(body).toBeEnabled();
    await expect(body).toHaveValue(
      operation === "generate" ? "SYNTHETIC newer manual content" : "SYNTHETIC submitted content",
    );
    await expect(form).toHaveAttribute("aria-busy", "false");
    await body.fill("SYNTHETIC retry draft");
    await expect(body).toHaveValue("SYNTHETIC retry draft");
  });
}
