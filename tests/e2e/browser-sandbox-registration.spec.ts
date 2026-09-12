import { expect, test } from "@playwright/test";

test("managed registration is unavailable when deployment is disabled", async ({ page }) => {
  await page.goto("/testing/browser-sandbox-registration");
  await expect(page.getByRole("button", { name: "创建托管节点" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "托管节点名称" })).toBeDisabled();
});

test("managed registration validates name and sends only the managed command", async ({ page }) => {
  await page.goto("/testing/browser-sandbox-registration?enabled=1");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "创建托管节点" }).click();
  await expect(page.getByRole("textbox", { name: "托管节点名称" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByRole("textbox", { name: "托管节点名称" }).fill("  Synthetic managed node  ");
  // Inspect the actual server-action request; never create an account or cloud VM.
  await page.route("**/testing/browser-sandbox-registration?**", async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && Boolean(r.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "创建托管节点" }).click();
  const body = (await sent).postData() ?? "";
  expect(body).toContain('"operation":"create-sandbox"');
  expect(body).toContain('"name":"Synthetic managed node"');
  expect(body).not.toContain("gatewayOrigin");
  expect(body).not.toContain("accessKey");
});
