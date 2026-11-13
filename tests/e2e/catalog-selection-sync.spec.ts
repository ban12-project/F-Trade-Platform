import { expect, test } from "@playwright/test";
import type { CatalogImportView } from "../../lib/product/catalog-import-contracts";

for (const remaining of [0, 1]) {
  test(`catalog refresh removes unavailable selections and retains ${remaining} eligible records`, async ({
    page,
  }) => {
    const projectId = "00000000-0000-4000-8000-000000000202";
    const view: CatalogImportView = {
      id: "00000000-0000-4000-8000-000000000901",
      status: "ready",
      failureCode: null,
      candidates: [0, 1, 2].map((index) => ({
        id: `00000000-0000-4000-8000-00000000090${index + 2}`,
        identifier: `SYNTHETIC-${index}`,
        physicalPage: null,
        recordLine: index + 1,
        duplicateIdentifier: false,
        status: "available",
        attempts: 0,
        failureCode: null,
        productId: null,
      })),
    };
    let writes = 0;
    await page.route("**/testing/project-workflow?**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const [input] = JSON.parse(route.request().postData() ?? "[]");
      let result: unknown = { status: "success", view };
      if (typeof input !== "string" && input.candidateIds) {
        writes++;
        expect(input.candidateIds).toEqual([view.candidates[2]?.id]);
        expect(input.model).toBe("gpt-5.6-terra");
        result = { status: "error", message: "Synthetic selection rejection" };
      } else if (typeof input !== "string") {
        expect(input).toEqual({ projectId, importId: view.id });
        view.candidates = view.candidates.map((candidate, index) => ({
          ...candidate,
          status: remaining === 1 && index === 2 ? "failed" : "completed",
          attempts: 1,
        }));
        result = { status: "success", view };
      }
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(result)}\n`,
      });
    });
    await page.goto("/testing/project-workflow?record=product");
    await page.getByRole("tab", { name: "产品目录", exact: true }).click();
    await page.getByRole("button", { name: "高级设置：抽取模型", exact: true }).click();
    const model = page.getByLabel("抽取模型", { exact: true });
    await model.selectOption({ index: 1 });
    const chosenModel = await model.inputValue();
    await page.getByRole("button", { name: "选择前 20 条可用记录", exact: true }).click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(3);
    await page.getByRole("button", { name: "刷新进度", exact: true }).click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(remaining);
    await expect(
      page.getByRole("status").filter({
        hasText: `目录状态已更新，已从选择中移除 ${3 - remaining} 条当前不可生成的记录。`,
      }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox").first()).toBeDisabled();
    await expect(model).toHaveValue(chosenModel);
    const submit = page.getByRole("button", {
      name: `生成 ${remaining} 条待审核草稿`,
      exact: true,
    });
    if (remaining) {
      await expect(page.getByRole("checkbox").last()).toBeChecked();
      await submit.click();
      await expect(page.getByText("Synthetic selection rejection", { exact: true })).toBeVisible();
      expect(writes).toBe(1);
      await expect(page.getByRole("checkbox").last()).toBeChecked();
    } else {
      await expect(submit).toBeDisabled();
      expect(writes).toBe(0);
    }
  });
}
