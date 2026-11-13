import { expect, test } from "@playwright/test";

test("standalone evidence upload clears only after success and accepts the next file", async ({
  page,
}) => {
  let uploads = 0;
  let registrations = 0;
  const filenames: string[] = [];
  const receiptIds: string[] = [];
  // Keep real client upload orchestration but simulate storage and the action result.
  // The real unauthenticated action is fetched first; it must refuse the registration.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/product-documents/upload") {
      const body = request.postDataJSON();
      const payload = JSON.parse(body.payload.clientPayload);
      filenames.push(payload.originalFilename);
      receiptIds.push(payload.receiptId);
      return route.fulfill({
        json: {
          presignedUrlPayload: {
            delegationToken: `${Buffer.from(JSON.stringify({ storeId: "synthetic" })).toString("base64url")}.synthetic`,
            signature: "synthetic",
            params: {},
          },
        },
      });
    }
    if (url.hostname === "vercel.com" && url.pathname.startsWith("/api/blob")) {
      expect(request.method()).toBe("PUT");
      uploads++;
      return route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: {
          url: "https://synthetic.invalid/file.csv",
          downloadUrl: "https://synthetic.invalid/file.csv",
          pathname: url.searchParams.get("pathname"),
          contentType: "text/csv",
          contentDisposition: "attachment",
          etag: "synthetic",
        },
      });
    }
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
    if (request.headers()["next-action"]) {
      const response = await route.fetch();
      const body = await response.text();
      expect(body).toContain('"status":"error","message":"无权上传资料。"');
      registrations++;
      return route.fulfill({
        response,
        body: body.replace(
          '"status":"error","message":"无权上传资料。"',
          '"status":"success","message":"SYNTHETIC 资料已保存"',
        ),
      });
    }
    return route.continue();
  });
  await page.goto("/testing/project-workflow?state=product-revision");
  const file = page.getByLabel("资料文件", { exact: true });
  const save = page.getByRole("button", { name: "保存到项目资料库", exact: true });
  for (const [index, name] of ["synthetic-first.csv", "synthetic-second.csv"].entries()) {
    await expect(file).toBeEnabled();
    await file.setInputFiles({
      name,
      mimeType: "text/csv",
      buffer: Buffer.from("SYNTHETIC,value\nexample,1"),
    });
    await expect(page.getByText("SYNTHETIC 资料已保存", { exact: true })).toHaveCount(0);
    await save.click();
    await expect.poll(() => registrations).toBe(index + 1);
    await expect(page.getByText("SYNTHETIC 资料已保存", { exact: true })).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(file).toHaveValue("");
    expect(await file.evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
    // Native required validation must prevent re-upload of the previously saved file.
    await save.click();
    await expect(file).toBeFocused();
    expect(uploads).toBe(index + 1);
    expect(registrations).toBe(index + 1);
  }
  expect(filenames).toEqual(["synthetic-first.csv", "synthetic-second.csv"]);
  expect(new Set(receiptIds).size).toBe(2);
});
