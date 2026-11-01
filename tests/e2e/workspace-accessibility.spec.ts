import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "/auth",
  "/testing/workspace-dashboard",
  "/testing/project-workflow",
  "/testing/product-field-evidence",
  "/testing/product-media",
  "/testing/video-workspace",
  "/testing/business-closure",
];

test("media choices have accessible names before hydration", async ({ page }) => {
  let release = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto("/testing/product-media", { waitUntil: "commit" });
    for (const name of ["素材来源", "素材角色"]) {
      await expect(page.getByRole("combobox", { name, exact: true })).toBeVisible();
    }
    for (const name of [
      "产品清晰可见",
      "包含 Logo",
      "画面包含文字",
      "允许剪辑",
      "允许公开发布",
      "允许付费广告",
      "允许图生视频",
      "允许作为视频参考素材",
    ]) {
      await expect(page.getByRole("checkbox", { name, exact: true })).toBeVisible();
    }
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

for (const theme of ["light", "dark"] as const) {
  for (const route of routes) {
    test(`${theme} ${route} has no detected WCAG A/AA violations`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await page.evaluate(async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await document.fonts.ready;
      }, theme);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach("accessibility-results", {
        body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }),
        contentType: "application/json",
      });
      expect(
        result.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      ).toEqual([]);
    });
  }
}
