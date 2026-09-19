import { expect, test } from "@playwright/test";
import type { CatalogImportView } from "../../lib/product/catalog-import-contracts";

test("catalog browser selects 20 independent records, restores progress and retries a failed row (synthetic transport)", async ({
  page,
}) => {
  const projectId = "00000000-0000-4000-8000-000000000202";
  const importId = "00000000-0000-4000-8000-000000000901";
  const candidates: CatalogImportView["candidates"] = Array.from({ length: 21 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
    identifier: `RYC-MOCK${index === 1 ? 0 : index}`,
    physicalPage: index + 1,
    recordLine: index * 5 + 1,
    duplicateIdentifier: index < 2,
    status: "available",
    attempts: 0,
    failureCode: null,
    productId: null,
  }));
  let view: CatalogImportView | null = null;
  let blobUploaded = false;
  let uploadReceipt = "";
  let submissions = 0;
  const source = Buffer.from("Internal SKU,Product name\nRYC-MOCK0,MOCK clutch kit\n");
  await page.route("**/api/product-documents/upload", async (route) => {
    const request = route.request().postDataJSON();
    const payload = JSON.parse(request.payload.clientPayload);
    expect(payload).toMatchObject({
      projectId,
      purpose: "agent",
      originalFilename: "synthetic.csv",
      contentType: "text/csv",
      sizeBytes: source.length,
    });
    uploadReceipt = payload.receiptId;
    const token = `${Buffer.from(JSON.stringify({ storeId: "synthetic" })).toString("base64url")}.synthetic`;
    await route.fulfill({
      json: { presignedUrlPayload: { delegationToken: token, signature: "synthetic", params: {} } },
    });
  });
  await page.route("https://vercel.com/api/blob/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "PUT, OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
      return;
    }
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataBuffer()).toEqual(source);
    blobUploaded = true;
    await route.fulfill({
      json: {
        url: "https://synthetic.private.blob.vercel-storage.com/synthetic.csv",
        downloadUrl: "https://synthetic.private.blob.vercel-storage.com/synthetic.csv",
        pathname: `product-documents/${projectId}/${uploadReceipt}.csv`,
        contentType: "text/csv",
        contentDisposition: "attachment",
      },
    });
  });
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    expect(route.request().headers()["next-action"]).toBeTruthy();
    const [input] = JSON.parse(route.request().postData() ?? "[]");
    if (typeof input === "string") expect(input).toBe(projectId);
    else if (input.receiptId) {
      expect(blobUploaded).toBe(true);
      expect(input).toEqual({ projectId, receiptId: uploadReceipt });
      view = { id: importId, status: "ready", failureCode: null, candidates };
    } else if (input.candidateIds) {
      expect(Object.keys(input).sort()).toEqual([
        "candidateIds",
        "importId",
        "model",
        "modelConfigId",
        "projectId",
      ]);
      expect(input).toMatchObject({
        projectId,
        importId,
        modelConfigId: "00000000-0000-4000-8000-000000000501",
        model: "gpt-5-mini",
      });
      submissions++;
      expect(input.candidateIds).toEqual(
        submissions === 1
          ? candidates.slice(0, 20).map((candidate) => candidate.id)
          : [candidates[0]?.id],
      );
      for (const candidate of candidates.filter((candidate) =>
        input.candidateIds.includes(candidate.id),
      )) {
        candidate.attempts++;
        const fail = submissions === 1 && candidate.id === candidates[0]?.id;
        candidate.status = fail ? "failed" : "completed";
        candidate.failureCode = fail ? "MODEL_FAILED" : null;
        candidate.productId = fail ? null : candidate.id;
      }
    } else expect(input).toEqual({ projectId, importId });
    // Actual Next Action response framing; no business write or provider request occurs here.
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: "success", view })}\n`,
    });
  });
  await page.goto("/testing/project-workflow?panel=product");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "产品目录" }).click();
  await page
    .getByLabel("产品资料", { exact: true })
    .setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: source });
  await page.getByRole("button", { name: "上传并解析目录" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(21);
  await expect(page.getByText("重复编号", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "选择前 20 条可用记录" }).click();
  await expect(page.getByRole("checkbox").last()).toBeDisabled();
  await page.getByRole("button", { name: "生成 20 条待审核草稿" }).click();
  await expect(page.getByRole("button", { name: "查看草稿" })).toHaveCount(19);
  await expect(page.getByText("抽取未通过，请检查模型配置后重试。", { exact: true })).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "产品目录" }).click();
  await expect(page.getByRole("button", { name: "查看草稿" })).toHaveCount(19);
  await page.getByRole("button", { name: "选择失败记录", exact: true }).click();
  await page.getByRole("button", { name: "生成 1 条待审核草稿" }).click();
  await expect(page.getByRole("button", { name: "查看草稿" })).toHaveCount(20);
  await expect(page.getByRole("button", { name: "查看草稿" }).first()).toHaveAttribute(
    "href",
    `/workspace/${projectId}/records/product/${candidates[0]?.id}`,
  );
  expect(submissions).toBe(2);
  expect(candidates[0]?.attempts).toBe(2);
  expect(candidates[1]?.attempts).toBe(1);
});

test("shared intake keeps the chosen file across methods and protects abandoning it on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      contentType: "text/x-component",
      body: '0:{"a":"$@1","f":"","b":"synthetic"}\n1:{"status":"success","view":null}\n',
    });
  });
  await page.goto("/testing/project-workflow?panel=product");
  const file = page.getByLabel("产品资料", { exact: true });
  await file.setInputFiles({
    name: "synthetic-shared.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Product name,SKU\nSYNTHETIC,MOCK-401\n"),
  });
  await page.getByRole("tab", { name: "产品目录", exact: true }).click();
  await expect(page).toHaveURL(/method=catalog/);
  await expect(page.getByText("所选文件：synthetic-shared.csv", { exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "单个产品", exact: true }).click();
  await expect(page.getByText("所选文件：synthetic-shared.csv", { exact: true })).toBeVisible();
  expect(await file.evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe(
    "synthetic-shared.csv",
  );
  await page.getByRole("tab", { name: "手动录入", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByRole("tab", { name: "单个产品", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "手动录入", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(page).toHaveURL(/method=manual/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "手动录入", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "单个产品", exact: true }).click();
  await expect(page.getByText("所选文件：synthetic-shared.csv", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
