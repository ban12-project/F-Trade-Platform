import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const state of [
    "new-work",
    "validation",
    "navigation-drawer",
    "settings",
    "members",
    "member-sheet",
    "member-removal",
    "member-removal-hover",
    "agent-settings",
  ] as const) {
    test(`${theme} ${state} accessibility`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme });
      let writes = 0;
      await page.route("**/*", async (route) => {
        if (route.request().method() === "POST") {
          writes++;
          await route.abort();
        } else await route.continue();
      });
      await page.goto(
        state === "settings" || state === "agent-settings"
          ? "/testing/agent-settings"
          : ["members", "member-sheet", "member-removal", "member-removal-hover"].includes(state)
            ? "/testing/project-workspace"
            : "/testing/workspace-navigation",
      );
      await expect(page.getByRole("main")).toBeVisible();
      await page.evaluate(async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await document.fonts.ready;
      }, theme);
      if (state === "new-work" || state === "validation") {
        await page.getByRole("button", { name: "开始新工作", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "开始新工作", exact: true });
        await expect(dialog).toBeVisible();
        if (state === "validation") {
          await dialog.getByLabel("归属项目").selectOption("new");
          await dialog.getByRole("button", { name: "创建项目并开始" }).click();
          await expect(dialog.getByLabel("项目名称", { exact: true })).toHaveAttribute(
            "aria-invalid",
            "true",
          );
        }
      }
      if (state === "navigation-drawer") {
        await expect(page.getByRole("button", { name: "开始新工作", exact: true })).toBeEnabled();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "打开导航" }).click();
        await expect(page.getByRole("dialog", { name: "工作区导航", exact: true })).toBeVisible();
      }
      if (state === "agent-settings") {
        await page.getByRole("tab", { name: "Agent", exact: true }).click();
        await expect(page.getByRole("combobox", { name: "模型配置", exact: true })).toBeVisible();
      }
      if (
        state === "member-sheet" ||
        state === "member-removal" ||
        state === "member-removal-hover"
      ) {
        await page.getByRole("button", { name: "成员 2", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "项目成员", exact: true })).toBeVisible();
        if (state === "member-removal" || state === "member-removal-hover") {
          await page
            .getByRole("button", { name: "移除成员 Synthetic Viewer", exact: true })
            .click();
          await expect(
            page.getByRole("alertdialog", { name: "移除项目成员？", exact: true }),
          ).toBeVisible();
        }
      }
      if (state === "member-removal-hover") {
        await page.getByRole("button", { name: "移除 Synthetic Viewer", exact: true }).hover();
        await page.evaluate(async () => {
          await Promise.all(
            document.getAnimations().map((animation) => animation.finished.catch(() => {})),
          );
        });
      }
      // Audit the settled overlay, including Base UI's focus-management effects.
      await page.evaluate(async () => {
        await Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      });
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
      expect(writes).toBe(0);
    });
  }
}
