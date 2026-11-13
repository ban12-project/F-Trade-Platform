import { expect, test } from "@playwright/test";
import type { CatalogImportView } from "../../lib/product/catalog-import-contracts";

for (const mode of ["automatic", "manual"] as const) {
  test(`${mode} progress recovery preserves unresolved catalog submission feedback`, async ({
    page,
  }) => {
    let reads = 0;
    let writes = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view: CatalogImportView = {
      id: "00000000-0000-4000-8000-000000000901",
      status: "ready",
      failureCode: null,
      candidates: [0, 1].map((index) => ({
        id: `00000000-0000-4000-8000-00000000090${index + 2}`,
        identifier: `SYNTHETIC-${index}`,
        physicalPage: null,
        recordLine: index + 1,
        duplicateIdentifier: false,
        status: index === 0 ? "available" : mode === "automatic" ? "running" : "completed",
        attempts: 1,
        failureCode: null,
        productId: null,
      })),
    };
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const [input] = JSON.parse(route.request().postData() ?? "[]");
      let result: unknown = { status: "success", view };
      if (typeof input !== "string" && input.candidateIds) {
        writes++;
        result = { status: "error", message: "Synthetic selection not accepted" };
      } else if (typeof input !== "string") {
        expect(input.importId).toBe(view.id);
        reads++;
        if (reads === 1) {
          await held;
          if (mode === "automatic") return route.abort("failed");
          result = { status: "error", message: "Synthetic progress unavailable" };
        } else {
          view.candidates = view.candidates.map((candidate, index) =>
            index === 1 ? { ...candidate, status: "completed" } : candidate,
          );
        }
      }
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(result)}\n`,
      });
    });
    try {
      await page.goto("/testing/project-workflow?record=product");
      await page.getByRole("tab", { name: "产品目录", exact: true }).click();
      const candidate = page.getByRole("checkbox", {
        name: "选择 SYNTHETIC-0，第 1 行",
        exact: true,
      });
      await candidate.check();
      await page.getByRole("button", { name: "生成 1 条待审核草稿", exact: true }).click();
      const operationError = page.getByText("Synthetic selection not accepted", { exact: true });
      await expect(operationError).toBeVisible();
      const refresh = page.getByRole("button", { name: "刷新进度", exact: true });
      if (mode === "manual") await refresh.click();
      await expect.poll(() => reads).toBe(1);
      release();
      const stale = page.getByText("当前显示上次读取的目录进度，请刷新后再核对。", { exact: true });
      await expect(stale).toBeVisible();
      await expect(operationError).toBeVisible();
      await expect(candidate).toBeChecked();
      await refresh.click();
      await expect.poll(() => reads).toBe(2);
      await expect(stale).toHaveCount(0);
      await expect(operationError).toBeVisible();
      await expect(candidate).toBeChecked();
      await expect(page.getByText("1 条草稿", { exact: true })).toBeVisible();
      expect(writes).toBe(1);
    } finally {
      release();
    }
  });
}
