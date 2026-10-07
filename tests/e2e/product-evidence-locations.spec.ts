import { expect, test } from "@playwright/test";

const path = "/testing/project-workflow?record=product&state=product-review-locations";
const original =
  "/api/product-evidence/00000000-0000-4000-8000-000000000202/00000000-0000-4000-8000-000000000301/evidence-paged-mock";

test("PDF source positions stay attached to the matched field", async ({ page }) => {
  await page.goto(path);
  const source = page.getByRole("region", { name: "MOCK PDF source locations", exact: true });
  await expect(
    source.getByText("来源位置：原件第 3 页 · 解析文本第 8 行", { exact: true }),
  ).toBeVisible();
  const target = source.getByRole("link", {
    name: "查看产品名称来源第 3 页（新窗口）",
    exact: true,
  });
  await expect(target).toHaveAttribute("href", `${original}#page=3`);
  await expect(target).toHaveAttribute("target", "_blank");
  await expect(target).toHaveAttribute("rel", "noopener noreferrer");
  await expect(
    source.getByRole("link", { name: "打开来源原件（新窗口）", exact: true }),
  ).toHaveAttribute("href", original);
  const missingField = source
    .locator("div")
    .filter({ has: page.getByText("产品编号", { exact: true }) });
  await expect(
    missingField.getByText("未保留可直接展示的原文片段，请对照上方原件。", { exact: true }),
  ).toBeVisible();
  await expect(missingField.getByRole("link")).toHaveCount(0);
});

test("CSV positions and legacy sources do not create PDF page targets", async ({ page }) => {
  await page.goto(path);
  const csv = page.getByRole("region", { name: "MOCK CSV source locations", exact: true });
  await expect(csv.getByText("来源位置：解析文本第 3 行", { exact: true })).toBeVisible();
  await expect(csv.locator('a[href*="#page="]')).toHaveCount(0);
  const legacy = page.getByRole("region", { name: "MOCK mixed source coverage", exact: true });
  await expect(legacy.locator('a[href*="#page="]')).toHaveCount(0);
  await expect(legacy.getByText(/来源位置：/)).toHaveCount(0);
  await expect(
    legacy.getByRole("link", { name: "打开来源原件（新窗口）", exact: true }),
  ).toBeVisible();
});

test("keyboard opens the matched private source with a browser-only page fragment", async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  // Exercise the compiled link and keyboard navigation. Replace the binary transport only;
  // real native conversion, receipt/hash validation and database authorization run separately.
  await context.route(`**${original}`, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      contentType: "text/html",
      body: "<title>MOCK source transport</title><p>MOCK transport only</p>",
    });
  });
  await page.goto(path);
  const target = page.getByRole("link", { name: "查看产品名称来源第 3 页（新窗口）", exact: true });
  await target.focus();
  await expect(target).toBeFocused();
  const opened = page.waitForEvent("popup");
  await target.press("Enter");
  const popup = await opened;
  await expect(popup).toHaveURL(new RegExp(`${original}#page=3$`));
  await expect(popup.getByText("MOCK transport only", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).pathname).toBe(original);
  expect(new URL(requests[0]).hash).toBe("");
  await expect(
    page.getByRole("region", { name: "MOCK PDF source locations", exact: true }),
  ).toBeVisible();
  await popup.close();
});
