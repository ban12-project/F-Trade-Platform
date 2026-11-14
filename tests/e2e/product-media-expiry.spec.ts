import { expect, test } from "@playwright/test";

for (const scenario of [
  {
    zone: "America/New_York",
    gap: "2027-03-14T02:30",
    valid: "2027-03-14T03:30",
    fold: "2027-11-07T01:30",
    later: "2027-11-07T06:30:00.000Z",
  },
  {
    zone: "Australia/Lord_Howe",
    gap: "2027-10-03T02:15",
    valid: "2027-10-03T02:45",
    fold: "2027-04-04T01:45",
    later: "2027-04-03T15:15:00.000Z",
  },
]) {
  test.describe(scenario.zone, () => {
    test.use({ timezoneId: scenario.zone, viewport: { width: 390, height: 844 } });
    for (const mode of ["gap", "fold"] as const) {
      test(`rights expiry ${mode} is resolved before uploading and preserves input`, async ({
        page,
      }) => {
        await page.route("**/testing/product-media", async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          await route.fulfill({
            contentType: "text/x-component",
            body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ options: [{ id: "evidence-synthetic-rights-995", label: "合成素材授权书.pdf" }], error: "" })}\n`,
          });
        });
        let uploads = 0;
        await page.route("**/api/video-assets/upload", async (route) => {
          uploads++;
          await route.fulfill({ status: 403, json: { error: "SYNTHETIC upload denied" } });
        });
        await page.goto("/testing/product-media");
        const file = page.getByLabel("图片或视频", { exact: true });
        await expect(file).toBeEnabled();
        await file.setInputFiles({
          name: "synthetic.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("SYNTHETIC no upload"),
        });
        const description = page.getByLabel("内容说明", { exact: true });
        await description.fill("SYNTHETIC description retained");
        await page.getByRole("combobox", { name: "素材使用授权证明", exact: true }).click();
        await page.getByRole("option", { name: "合成素材授权书.pdf", exact: true }).click();
        const expiry = page.getByLabel("授权到期时间", { exact: true });
        await expect(expiry).toHaveAccessibleDescription(new RegExp(scenario.zone));
        await expiry.fill(mode === "gap" ? scenario.gap : scenario.fold);
        const save = page.getByRole("button", { name: "上传素材并提交审核", exact: true });
        await save.click();
        if (mode === "gap") {
          await expect(expiry).toBeFocused();
          await expect(expiry).toHaveAccessibleDescription(/不存在或无效/);
          expect(uploads).toBe(0);
          await expiry.fill(scenario.valid);
          await expect(expiry).toHaveAttribute("aria-invalid", "false");
        } else {
          const occurrence = page.getByLabel("授权到期重复时间选择", { exact: true });
          await expect(occurrence).toBeFocused();
          await expect(occurrence).toHaveAccessibleDescription(/请选择具体授权到期时刻/);
          expect(uploads).toBe(0);
          await occurrence.selectOption(scenario.later);
          await expect(occurrence).toHaveAttribute("aria-invalid", "false");
          await expiry.fill(scenario.valid);
          await expiry.fill(scenario.fold);
          await expect(occurrence).toHaveValue("");
          await occurrence.selectOption(scenario.later);
        }
        await save.click();
        await expect.poll(() => uploads).toBe(1);
        await expect(save).toBeEnabled();
        await expect(description).toHaveValue("SYNTHETIC description retained");
        expect(await file.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
          "synthetic.jpg",
        );
        await expect(expiry).toHaveValue(mode === "gap" ? scenario.valid : scenario.fold);
        // Clearing an expiry explicitly retains the existing indefinite-rights option.
        await expiry.fill("");
        await save.click();
        await expect.poll(() => uploads).toBe(2);
      });
    }
  });
}
